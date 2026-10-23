/// <reference path="../pb_data/types.d.ts" />
// Схема Ordius: компании, участники и роли, справочники, смены, ставки, выплаты, задачи, документы.
//
// Главный принцип: человек видит и меняет данные только тех компаний, где он активный участник,
// и только в пределах своих ролей. Это проверяют правила доступа PocketBase на каждом запросе.
// Деньги — целые копейки (*_kop). Коэффициенты — в тысячных (1500 = ×1,5).
migrate((app) => {
  const ROLES = ["owner", "manager", "dispatcher", "mechanic", "driver", "accountant"];

  // ---------- правила доступа ----------
  // Участник компании: активное членство текущего пользователя в компании из поля c.
  const member = (c) =>
    `@request.auth.id != "" && @collection.memberships:me.company ?= ${c}` +
    ` && @collection.memberships:me.user ?= @request.auth.id && @collection.memberships:me.status ?= "active"`;
  // Участник с одной из ролей. Роли — список; через @collection PocketBase сравнивает его как строку
  // JSON (["owner","driver"]), поэтому ищем вхождение «?~». Названия ролей не входят одно в другое.
  const role = (c, roles) =>
    `${member(c)} && (${roles.map((r) => `@collection.memberships:me.roles ?~ '"${r}"'`).join(" || ")})`;
  const MGMT = ["owner", "manager"];
  const OFFICE = ["owner", "manager", "dispatcher", "accountant"];
  const MONEY = ["owner", "manager", "accountant"];

  // ---------- поля ----------
  const created = () => ({ name: "created", type: "autodate", onCreate: true, onUpdate: false });
  const updated = () => ({ name: "updated", type: "autodate", onCreate: true, onUpdate: true });
  const text = (name, opts = {}) => ({ name, type: "text", max: 500, ...opts });
  const num = (name, opts = {}) => ({ name, type: "number", ...opts });
  const int = (name, opts = {}) => ({ name, type: "number", onlyInt: true, ...opts });
  const bool = (name) => ({ name, type: "bool" });
  const date = (name, opts = {}) => ({ name, type: "date", ...opts });
  const select = (name, values, opts = {}) => ({ name, type: "select", values, maxSelect: 1, ...opts });
  const rel = (name, collectionId, opts = {}) =>
    ({ name, type: "relation", collectionId, maxSelect: 1, cascadeDelete: false, ...opts });
  const json = (name) => ({ name, type: "json", maxSize: 100000 });
  const PHONE = "^\\+[0-9]{10,15}$";

  const make = (name, fields, indexes = []) => {
    const c = new Collection({ type: "base", name, fields, indexes });
    app.save(c);
    return c;
  };

  // ---------- пользователи (вход по телефону или почте) ----------
  const users = app.findCollectionByNameOrId("users");
  // Не hidden: скрытое поле PocketBase не принимает от клиента даже при регистрации.
  // Чужим телефон не отдаётся — его убирает хук onRecordEnrich (виден только самому человеку).
  users.fields.add(new TextField({ name: "phone", pattern: PHONE, max: 16 }));
  const email = users.fields.getByName("email");
  email.required = false;
  const name = users.fields.getByName("name");
  name.required = true;
  name.max = 120;
  users.passwordAuth.identityFields = ["phone", "email"];
  users.indexes.push("CREATE UNIQUE INDEX idx_users_phone ON users (phone) WHERE phone != ''");
  app.save(users);

  // ---------- подтверждение номера звонком (только для сервера: правил доступа нет) ----------
  // Каждая запись — один звонок: номер, цель, код до проверки, попытки, билет после проверки.
  // Хранится 30 дней (нужно для лимитов и разбора злоупотреблений), потом удаляется задачей по расписанию.
  make("phone_checks", [
    text("phone", { required: true, pattern: PHONE, max: 16 }),
    select("purpose", ["signup", "login", "reset", "change"], { required: true }),
    select("status", ["sent", "verified", "used", "failed"], { required: true }),
    text("code", { max: 8 }),
    int("attempts", { min: 0 }),
    date("expires", { required: true }),
    text("ticket_hash", { max: 64 }),
    date("ticket_expires"),
    text("ip_hash", { max: 64 }),
    rel("user", users.id, { cascadeDelete: true }),
    text("call_id", { max: 64 }),
    num("cost", { min: 0 }),
    created(),
  ], [
    "CREATE INDEX idx_phone_checks_phone ON phone_checks (phone, created)",
    "CREATE INDEX idx_phone_checks_ip ON phone_checks (ip_hash, created)",
    "CREATE INDEX idx_phone_checks_created ON phone_checks (created)",
    "CREATE UNIQUE INDEX idx_phone_checks_ticket ON phone_checks (ticket_hash) WHERE ticket_hash != ''",
  ]);

  // ---------- компании и участники ----------
  const companies = make("companies", [
    text("name", { required: true, max: 200 }),
    text("inn", { pattern: "^[0-9]{10}([0-9]{2})?$", max: 12 }),
    text("join_code", { max: 16 }),
    select("plan", ["pilot", "free", "start", "business"]),
    rel("created_by", users.id),
    created(), updated(),
  ], ["CREATE UNIQUE INDEX idx_companies_join_code ON companies (join_code) WHERE join_code != ''"]);

  const memberships = make("memberships", [
    rel("company", companies.id, { required: true }),
    rel("user", users.id),
    text("display_name", { required: true, max: 120 }),
    text("phone", { pattern: PHONE, max: 16 }),
    select("roles", ROLES, { required: true, maxSelect: ROLES.length }),
    select("status", ["pending", "active", "dismissed"], { required: true }),
    text("personnel_no", { max: 32 }),
    date("hired_on"), date("dismissed_on"),
    text("note", { max: 1000 }),
    // личное приглашение для заведённого руководителем человека (видит только сервер)
    text("invite_code", { max: 16, hidden: true }),
    date("invite_expires", { hidden: true }),
    // одноразовый код смены пароля для сотрудника без почты (выдаёт руководитель, видит только сервер)
    text("reset_code", { max: 16, hidden: true }),
    date("reset_expires", { hidden: true }),
    created(), updated(),
  ], [
    "CREATE UNIQUE INDEX idx_memberships_invite ON memberships (invite_code) WHERE invite_code != ''",
    "CREATE UNIQUE INDEX idx_memberships_reset ON memberships (reset_code) WHERE reset_code != ''",
    "CREATE UNIQUE INDEX idx_memberships_company_user ON memberships (company, user) WHERE user != ''",
    "CREATE INDEX idx_memberships_user ON memberships (user, status)",
  ]);

  // ---------- справочники ----------
  const vehicles = make("vehicles", [
    rel("company", companies.id, { required: true }),
    text("name", { required: true, max: 120 }),
    text("plate", { max: 20 }),
    select("kind", ["dump_truck", "truck", "loader", "excavator", "grader", "tractor", "road_sweeper",
      "vacuum_truck", "crane", "other"]),
    text("model", { max: 120 }),
    int("year", { min: 1950, max: 2100 }),
    text("vin", { max: 32 }),
    bool("active"),
    text("note", { max: 1000 }),
    created(), updated(),
  ], ["CREATE INDEX idx_vehicles_company ON vehicles (company)"]);

  const customers = make("customers", [
    rel("company", companies.id, { required: true }),
    text("name", { required: true, max: 200 }),
    text("inn", { pattern: "^[0-9]{10}([0-9]{2})?$", max: 12 }),
    text("contact", { max: 300 }),
    bool("active"),
    text("note", { max: 1000 }),
    created(), updated(),
  ], ["CREATE INDEX idx_customers_company ON customers (company)"]);

  const sites = make("sites", [
    rel("company", companies.id, { required: true }),
    text("name", { required: true, max: 200 }),
    rel("customer", customers.id),
    text("address", { max: 300 }),
    bool("active"),
    text("note", { max: 1000 }),
    created(), updated(),
  ], ["CREATE INDEX idx_sites_company ON sites (company)"]);

  // ---------- ставки: действуют с даты; самая точная (по водителю, технике, объекту, заказчику) побеждает ----------
  const rates = make("rates", [
    rel("company", companies.id, { required: true }),
    text("name", { max: 120 }),
    select("unit", ["hour", "shift", "trip", "tkm", "month"], { required: true }),
    int("amount_kop", { required: true, min: 0, max: 100000000 }),
    rel("member", memberships.id),
    rel("vehicle", vehicles.id),
    rel("site", sites.id),
    rel("customer", customers.id),
    date("valid_from", { required: true }),
    date("valid_to"),
    text("note", { max: 1000 }),
    created(), updated(),
  ], ["CREATE INDEX idx_rates_company ON rates (company, unit, valid_from)"]);

  const rateFactors = make("rate_factors", [
    rel("company", companies.id, { required: true }),
    select("kind", ["night", "holiday", "overtime"], { required: true }),
    int("factor_permille", { required: true, min: 1000, max: 5000 }),
    date("valid_from", { required: true }),
    date("valid_to"),
    created(), updated(),
  ], ["CREATE INDEX idx_rate_factors_company ON rate_factors (company, kind, valid_from)"]);

  // ---------- смены ----------
  const shifts = make("shifts", [
    rel("company", companies.id, { required: true }),
    rel("member", memberships.id, { required: true }),
    date("date", { required: true }),
    rel("site", sites.id),
    rel("customer", customers.id),
    select("status", ["draft", "submitted", "confirmed", "rejected"], { required: true }),
    bool("night"), bool("holiday"),
    text("note", { max: 2000 }),
    rel("created_by", users.id),
    rel("confirmed_by", users.id),
    date("confirmed_at"),
    text("reject_reason", { max: 1000 }),
    int("amount_kop"),
    json("calc"),
    created(), updated(),
  ], [
    "CREATE INDEX idx_shifts_company_date ON shifts (company, date)",
    "CREATE INDEX idx_shifts_member_date ON shifts (member, date)",
  ]);

  const shiftEntries = make("shift_entries", [
    rel("company", companies.id, { required: true }),
    rel("shift", shifts.id, { required: true, cascadeDelete: true }),
    rel("vehicle", vehicles.id),
    select("unit", ["hour", "shift", "trip", "tkm"], { required: true }),
    num("quantity", { min: 0, max: 100000 }),
    num("tons", { min: 0, max: 1000 }),
    num("km", { min: 0, max: 100000 }),
    bool("overtime"),
    text("note", { max: 1000 }),
    created(), updated(),
  ], ["CREATE INDEX idx_shift_entries_shift ON shift_entries (shift)"]);

  // ---------- удержания, премии, авансы, выплаты ----------
  const adjustments = make("adjustments", [
    rel("company", companies.id, { required: true }),
    rel("member", memberships.id, { required: true }),
    date("date", { required: true }),
    select("kind", ["damage", "fuel", "fine", "bonus", "other"], { required: true }),
    int("amount_kop", { required: true, min: -100000000, max: 100000000 }),
    text("note", { max: 1000 }),
    rel("created_by", users.id),
    created(), updated(),
  ], ["CREATE INDEX idx_adjustments_member_date ON adjustments (member, date)"]);

  const payouts = make("payouts", [
    rel("company", companies.id, { required: true }),
    rel("member", memberships.id, { required: true }),
    select("kind", ["advance", "salary", "bonus", "other"], { required: true }),
    int("amount_kop", { required: true, min: 1, max: 100000000 }),
    select("status", ["planned", "paid"], { required: true }),
    date("paid_on"),
    date("period_from"), date("period_to"),
    select("method", ["cash", "card", "bank", "other"]),
    text("issued_by", { max: 120 }),
    bool("member_confirmed"),
    date("member_confirmed_at"),
    text("note", { max: 1000 }),
    rel("created_by", users.id),
    created(), updated(),
  ], ["CREATE INDEX idx_payouts_member ON payouts (member, paid_on)"]);

  // ---------- задачи и обсуждения ----------
  const tasks = make("tasks", [
    rel("company", companies.id, { required: true }),
    text("title", { required: true, max: 200 }),
    text("description", { max: 5000 }),
    select("status", ["new", "in_progress", "waiting", "done", "cancelled"], { required: true }),
    select("priority", ["low", "normal", "high"]),
    rel("assignee", memberships.id),
    select("assignee_role", ROLES),
    rel("vehicle", vehicles.id),
    rel("shift", shifts.id),
    rel("created_by", users.id),
    date("due"), date("closed_at"),
    created(), updated(),
  ], ["CREATE INDEX idx_tasks_company_status ON tasks (company, status)"]);

  const taskEvents = make("task_events", [
    rel("company", companies.id, { required: true }),
    rel("task", tasks.id, { required: true, cascadeDelete: true }),
    rel("author", users.id),
    select("kind", ["comment", "status", "assign"], { required: true }),
    text("text", { max: 5000 }),
    text("from_status", { max: 20 }),
    text("to_status", { max: 20 }),
    created(),
  ], ["CREATE INDEX idx_task_events_task ON task_events (task)"]);

  const posts = make("posts", [
    rel("company", companies.id, { required: true }),
    rel("author", users.id),
    text("text", { required: true, max: 5000 }),
    bool("pinned"),
    created(), updated(),
  ], ["CREATE INDEX idx_posts_company ON posts (company)"]);

  // ---------- документы: фото путевых, ТТН, актов, чеков ----------
  const documents = make("documents", [
    rel("company", companies.id, { required: true }),
    select("kind", ["waybill", "ttn", "act", "receipt", "photo", "other"], { required: true }),
    {
      name: "files", type: "file", required: true, maxSelect: 10, maxSize: 15 * 1024 * 1024,
      mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"],
      thumbs: ["480x0"], protected: true,
    },
    rel("shift", shifts.id),
    rel("task", tasks.id),
    rel("vehicle", vehicles.id),
    rel("uploaded_by", users.id),
    text("note", { max: 1000 }),
    created(), updated(),
  ], [
    "CREATE INDEX idx_documents_company ON documents (company)",
    "CREATE INDEX idx_documents_shift ON documents (shift)",
  ]);

  // ---------- журнал изменений денег и доступа ----------
  const auditLog = make("audit_log", [
    rel("company", companies.id),
    rel("actor", users.id),
    select("action", ["create", "update", "delete"], { required: true }),
    text("collection_name", { max: 50 }),
    text("record_id", { max: 30 }),
    json("data"),
    created(),
  ], ["CREATE INDEX idx_audit_log_company ON audit_log (company, created)"]);

  // ---------- правила доступа (после создания всех коллекций, чтобы ссылки разрешались) ----------
  const rules = (c, r) => {
    Object.assign(c, r);
    app.save(c);
  };
  const isMe = (field) => `${field}.user = @request.auth.id`;

  rules(users, {
    // себя и коллег по своим компаниям
    listRule: `id = @request.auth.id || (@request.auth.id != "" && @collection.memberships:me.user ?= @request.auth.id && @collection.memberships:me.status ?= "active" && @collection.memberships:them.user ?= id && @collection.memberships:them.company ?= @collection.memberships:me.company)`,
    viewRule: `id = @request.auth.id || (@request.auth.id != "" && @collection.memberships:me.user ?= @request.auth.id && @collection.memberships:me.status ?= "active" && @collection.memberships:them.user ?= id && @collection.memberships:them.company ?= @collection.memberships:me.company)`,
    // регистрация — только с подтверждённым номером, через /api/ordius/signup
    createRule: null,
    updateRule: "id = @request.auth.id",
    deleteRule: null,
  });

  rules(companies, {
    listRule: member("id"),
    viewRule: member("id"),
    createRule: `@request.auth.id != ""`,
    updateRule: role("id", MGMT),
    deleteRule: null,
  });

  rules(memberships, {
    listRule: `user = @request.auth.id || (${member("company")})`,
    viewRule: `user = @request.auth.id || (${member("company")})`,
    // Руководитель заводит человека без аккаунта; аккаунт привязывается только самим человеком по коду.
    createRule: `${role("company", MGMT)} && @request.body.status != "pending" && user = ""`,
    updateRule: `${role("company", MGMT)} && @request.body.company:changed = false && @request.body.user:changed = false`,
    deleteRule: null,
  });

  for (const c of [vehicles, customers, sites]) {
    rules(c, {
      listRule: member("company"),
      viewRule: member("company"),
      createRule: role("company", MGMT),
      updateRule: `${role("company", MGMT)} && @request.body.company:changed = false`,
      deleteRule: role("company", MGMT),
    });
  }

  rules(rates, {
    listRule: `(${role("company", MONEY)}) || ${isMe("member")}`,
    viewRule: `(${role("company", MONEY)}) || ${isMe("member")}`,
    createRule: `${role("company", MGMT)} && (member = "" || member.company = company) && ` +
      `(vehicle = "" || vehicle.company = company) && (site = "" || site.company = company) && ` +
      `(customer = "" || customer.company = company)`,
    updateRule: `${role("company", MGMT)} && @request.body.company:changed = false`,
    deleteRule: role("company", MGMT),
  });

  rules(rateFactors, {
    listRule: role("company", MONEY),
    viewRule: role("company", MONEY),
    createRule: role("company", MGMT),
    updateRule: `${role("company", MGMT)} && @request.body.company:changed = false`,
    deleteRule: role("company", MGMT),
  });

  // Смена: водитель ведёт свою до подтверждения, диспетчер — любые до подтверждения,
  // подтверждает и возвращает только владелец или руководитель.
  const shiftView = `(${role("company", OFFICE)}) || ${isMe("member")}`;
  rules(shifts, {
    listRule: shiftView,
    viewRule: shiftView,
    createRule:
      `member.company = company && (site = "" || site.company = company) && (customer = "" || customer.company = company) && ` +
      `(@request.body.status = "draft" || @request.body.status = "submitted") && (` +
      `(${member("company")} && ${isMe("member")}) || (${role("company", ["owner", "manager", "dispatcher"])}))`,
    updateRule:
      `@request.body.company:changed = false && @request.body.member:changed = false && (` +
      `(${role("company", MGMT)}) || ` +
      `(${role("company", ["dispatcher"])} && status != "confirmed" && @request.body.status != "confirmed") || ` +
      `(${member("company")} && ${isMe("member")} && status != "confirmed" && ` +
      `(@request.body.status:isset = false || @request.body.status = "draft" || @request.body.status = "submitted")))`,
    deleteRule: `status != "confirmed" && ((${role("company", MGMT)}) || (${isMe("member")} && status = "draft"))`,
  });

  const entryView = `(${role("company", OFFICE)}) || shift.member.user = @request.auth.id`;
  const entryWrite = `shift.status != "confirmed" && ((${role("company", ["owner", "manager", "dispatcher"])}) || (${member("company")} && shift.member.user = @request.auth.id))`;
  rules(shiftEntries, {
    listRule: entryView,
    viewRule: entryView,
    createRule: `shift.company = company && (vehicle = "" || vehicle.company = company) && ${entryWrite}`,
    updateRule: `@request.body.company:changed = false && @request.body.shift:changed = false && ${entryWrite}`,
    deleteRule: entryWrite,
  });

  const moneyView = `(${role("company", MONEY)}) || ${isMe("member")}`;
  rules(adjustments, {
    listRule: moneyView,
    viewRule: moneyView,
    createRule: `member.company = company && ${role("company", MGMT)}`,
    updateRule: `@request.body.company:changed = false && @request.body.member:changed = false && ${role("company", MGMT)}`,
    deleteRule: role("company", MGMT),
  });

  rules(payouts, {
    listRule: moneyView,
    viewRule: moneyView,
    createRule: `member.company = company && ${role("company", MGMT)}`,
    // Сам получатель может только отметить «получил».
    updateRule:
      `@request.body.company:changed = false && @request.body.member:changed = false && (` +
      `(${role("company", MGMT)}) || ` +
      `(${isMe("member")} && @request.body.amount_kop:changed = false && @request.body.kind:changed = false && ` +
      `@request.body.status:changed = false && @request.body.paid_on:changed = false && ` +
      `@request.body.period_from:changed = false && @request.body.period_to:changed = false && ` +
      `@request.body.method:changed = false && @request.body.issued_by:changed = false && @request.body.note:changed = false))`,
    deleteRule: role("company", MGMT),
  });

  // Задачи видят автор, исполнитель и офис с механиками; ставит задачу любой участник.
  const taskView = `(${role("company", ["owner", "manager", "dispatcher", "mechanic"])}) || created_by = @request.auth.id || assignee.user = @request.auth.id`;
  rules(tasks, {
    listRule: taskView,
    viewRule: taskView,
    createRule: `${member("company")} && (assignee = "" || assignee.company = company) && ` +
      `(vehicle = "" || vehicle.company = company) && (shift = "" || shift.company = company)`,
    updateRule: `@request.body.company:changed = false && (${taskView})`,
    deleteRule: role("company", MGMT),
  });

  const taskEventView = `(${role("company", ["owner", "manager", "dispatcher", "mechanic"])}) || task.created_by = @request.auth.id || task.assignee.user = @request.auth.id`;
  rules(taskEvents, {
    listRule: taskEventView,
    viewRule: taskEventView,
    createRule: `task.company = company && @request.body.kind = "comment" && ${member("company")} && (${taskEventView})`,
    updateRule: null,
    deleteRule: null,
  });

  rules(posts, {
    listRule: member("company"),
    viewRule: member("company"),
    createRule: role("company", ["owner", "manager", "dispatcher"]),
    updateRule: `@request.body.company:changed = false && (author = @request.auth.id || ${role("company", MGMT)})`,
    deleteRule: `author = @request.auth.id || ${role("company", MGMT)}`,
  });

  const docView = `(${role("company", OFFICE)}) || uploaded_by = @request.auth.id || shift.member.user = @request.auth.id`;
  rules(documents, {
    listRule: docView,
    viewRule: docView,
    // Водитель прикладывает документы только к своим сменам; офис — к любым.
    createRule:
      `${member("company")} && (task = "" || task.company = company) && (vehicle = "" || vehicle.company = company) && ` +
      `(shift = "" || (shift.company = company && ((${role("company", OFFICE)}) || shift.member.user = @request.auth.id)))`,
    updateRule: `@request.body.company:changed = false && ((${role("company", MGMT)}) || uploaded_by = @request.auth.id)`,
    deleteRule: `(${role("company", MGMT)}) || (uploaded_by = @request.auth.id && (shift = "" || shift.status != "confirmed"))`,
  });

  rules(auditLog, {
    listRule: role("company", MGMT),
    viewRule: role("company", MGMT),
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
}, (app) => {
  for (const name of ["audit_log", "documents", "posts", "task_events", "tasks", "payouts", "adjustments",
    "shift_entries", "shifts", "rate_factors", "rates", "sites", "customers", "vehicles", "memberships", "companies",
    "phone_checks"]) {
    app.delete(app.findCollectionByNameOrId(name));
  }
});
