/// <reference path="../pb_data/types.d.ts" />
// Схема Ordius: компании, участники и роли, справочники, контракты заказчиков, смены, ставки, выручка,
// выплаты, задачи, документы, топливные карты, заправки, ТО, вахты, сообщения.
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
  // Единицы работы: в них считается и оплата людям, и цена заказчику. «month» — только у ставок и позиций контракта.
  const UNITS = ["hour", "shift", "trip", "tkm", "km", "lin_m", "sq_m", "cu_m", "ton", "piece"];

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
  // аккаунт — только российский мобильный (вход по номеру российского оператора, 406-ФЗ)
  const RU_MOBILE = "^\\+79[0-9]{9}$";

  const make = (name, fields, indexes = []) => {
    const c = new Collection({ type: "base", name, fields, indexes });
    app.save(c);
    return c;
  };

  // ---------- пользователи (вход по телефону или почте) ----------
  const users = app.findCollectionByNameOrId("users");
  // Не hidden: скрытое поле PocketBase не принимает от клиента даже при регистрации.
  // Чужим телефон не отдаётся — его убирает хук onRecordEnrich (виден только самому человеку).
  users.fields.add(new TextField({ name: "phone", pattern: RU_MOBILE, max: 12 }));
  const email = users.fields.getByName("email");
  email.required = false;
  const name = users.fields.getByName("name");
  name.required = true;
  name.max = 120;
  users.passwordAuth.identityFields = ["phone", "email"];
  users.indexes.push("CREATE UNIQUE INDEX idx_users_phone ON users (phone) WHERE phone != ''");
  app.save(users);

  // ---------- подтверждение номера звонком (только для сервера: правил доступа нет) ----------
  // Каждая запись — одна проверка номера: способ, цель, код или номер для звонка, попытки, билет.
  // Хранится 30 дней (нужно для лимитов и разбора злоупотреблений), потом удаляется задачей по расписанию.
  make("phone_checks", [
    text("phone", { required: true, pattern: RU_MOBILE, max: 12 }),
    select("purpose", ["signup", "login", "reset", "change"], { required: true }),
    // callcheck — человек звонит сам (основной способ), call — робот звонит человеку (запасной)
    select("method", ["callcheck", "call"], { required: true }),
    text("call_phone", { max: 16 }),
    date("last_checked"),
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
    // ставки вносятся «на руки» (net, по умолчанию) или до НДФЛ (gross) — от этого считается НДФЛ в ведомости
    select("rates_basis", ["net", "gross"]),
    // суточные без НДФЛ, коп. в день; пусто — 700 ₽ (п. 3 ст. 217 НК РФ)
    int("per_diem_free_kop", { min: 0, max: 10000000 }),
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
    // НДФЛ не удерживается: самозанятый, ИП
    bool("no_ndfl"),
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
    // нормы расхода топлива: л на 100 км и л на моточас (для спецтехники, работающей на месте)
    num("fuel_norm_100km", { min: 0, max: 1000 }),
    num("fuel_norm_hour", { min: 0, max: 500 }),
    // последние показания: руководитель вносит начальные, дальше сервер поднимает их по путевым, заправкам и ТО
    num("odometer_now", { min: 0, max: 10000000 }),
    num("engine_hours_now", { min: 0, max: 1000000 }),
    date("readings_at"),
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

  // ---------- контракты заказчиков: позиции без цен видят все, цены — только владелец, руководитель, бухгалтер ----------
  const contracts = make("contracts", [
    rel("company", companies.id, { required: true }),
    rel("customer", customers.id, { required: true }),
    text("number", { max: 100 }),
    date("signed_on"),
    text("title", { required: true, max: 300 }),
    date("valid_from"), date("valid_to"),
    // цена контракта (потолок), если есть — чтобы видеть, сколько уже выполнено
    int("limit_kop", { min: 0, max: 100000000000 }),
    select("status", ["active", "closed"], { required: true }),
    text("note", { max: 2000 }),
    created(), updated(),
  ], ["CREATE INDEX idx_contracts_company ON contracts (company, customer)"]);

  const contractItems = make("contract_items", [
    rel("company", companies.id, { required: true }),
    rel("contract", contracts.id, { required: true, cascadeDelete: true }),
    text("name", { required: true, max: 300 }),
    select("unit", [...UNITS, "month"], { required: true }),
    // к какой технике относится позиция: конкретная машина, вид техники или любая
    rel("vehicle", vehicles.id),
    select("vehicle_kind", ["dump_truck", "truck", "loader", "excavator", "grader", "tractor", "road_sweeper",
      "vacuum_truck", "crane", "other"]),
    num("planned_qty", { min: 0 }),
    bool("active"),
    text("note", { max: 1000 }),
    created(), updated(),
  ], ["CREATE INDEX idx_contract_items_contract ON contract_items (contract)"]);

  const contractPrices = make("contract_prices", [
    rel("company", companies.id, { required: true }),
    rel("item", contractItems.id, { required: true, cascadeDelete: true }),
    // цена за единицу как в контракте (с НДС, если он есть); ставка НДС — для акта и счёта
    int("price_kop", { required: true, min: 0, max: 100000000 }),
    select("vat", ["none", "0", "5", "7", "10", "20", "22"]),
    date("valid_from", { required: true }),
    date("valid_to"),
    text("note", { max: 1000 }),
    created(), updated(),
  ], ["CREATE INDEX idx_contract_prices_item ON contract_prices (item, valid_from)"]);

  const sites = make("sites", [
    rel("company", companies.id, { required: true }),
    text("name", { required: true, max: 200 }),
    rel("customer", customers.id),
    rel("contract", contracts.id),
    text("address", { max: 300 }),
    // координаты — для карты и маршрутов
    num("lat", { min: -90, max: 90 }),
    num("lng", { min: -180, max: 180 }),
    bool("active"),
    text("note", { max: 1000 }),
    created(), updated(),
  ], ["CREATE INDEX idx_sites_company ON sites (company)"]);

  // ---------- ставки: действуют с даты; самая точная (по водителю, технике, объекту, заказчику) побеждает ----------
  // per_diem — суточные за каждый день вахты (по графику вахт), month — оклад
  const rates = make("rates", [
    rel("company", companies.id, { required: true }),
    text("name", { max: 120 }),
    select("unit", [...UNITS, "month", "per_diem"], { required: true }),
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
    rel("contract", contracts.id),
    select("status", ["draft", "submitted", "confirmed", "rejected"], { required: true }),
    bool("night"), bool("holiday"),
    text("note", { max: 2000 }),
    // для электронного путевого листа (ЭПЛ): медосмотр водителя, выезд и возврат
    date("med_check_at"), date("departure_at"), date("return_at"),
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
    // единица и количество — для оплаты человеку; тонны и километры — для т·км (и как замеры)
    select("unit", UNITS, { required: true }),
    num("quantity", { min: 0, max: 1000000 }),
    num("tons", { min: 0, max: 1000 }),
    num("km", { min: 0, max: 100000 }),
    bool("overtime"),
    // позиция контракта заказчика и количество в её единицах (если они отличаются от единицы оплаты:
    // водителю — за часы, заказчику — за погонные метры)
    rel("contract_item", contractItems.id),
    num("bill_qty", { min: 0, max: 10000000 }),
    // для ЭПЛ: путевой лист, техосмотр, одометр, моточасы, топливо по этой машине
    text("waybill_no", { max: 50 }),
    date("tech_check_at"),
    num("odometer_start", { min: 0 }), num("odometer_end", { min: 0 }),
    num("engine_hours_start", { min: 0 }), num("engine_hours_end", { min: 0 }),
    num("fuel_start", { min: 0 }), num("fuel_end", { min: 0 }), num("fuel_added", { min: 0 }),
    text("note", { max: 1000 }),
    created(), updated(),
  ], ["CREATE INDEX idx_shift_entries_shift ON shift_entries (shift)"]);

  // ---------- выручка по подтверждённой смене: считает сервер, видят владелец, руководитель, бухгалтер ----------
  const shiftBills = make("shift_bills", [
    rel("company", companies.id, { required: true }),
    rel("shift", shifts.id, { required: true, cascadeDelete: true }),
    rel("customer", customers.id),
    rel("contract", contracts.id),
    date("date", { required: true }),
    int("amount_kop"),
    select("status", ["ok", "incomplete"], { required: true }),
    json("lines"),
    json("missing"),
    created(), updated(),
  ], [
    "CREATE UNIQUE INDEX idx_shift_bills_shift ON shift_bills (shift)",
    "CREATE INDEX idx_shift_bills_company_date ON shift_bills (company, date)",
  ]);

  // ---------- удержания, премии, авансы, выплаты ----------
  const adjustments = make("adjustments", [
    rel("company", companies.id, { required: true }),
    rel("member", memberships.id, { required: true }),
    date("date", { required: true }),
    // travel — компенсация дороги на вахту и обратно (плюсом, без НДФЛ)
    select("kind", ["damage", "fuel", "fine", "bonus", "travel", "other"], { required: true }),
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

  // ---------- ТО по пробегу, моточасам и времени ----------
  // План: что и как часто делать с машиной. Последнее выполнение вносится вручную один раз,
  // дальше его обновляет сервер по журналу ТО. Когда срок подходит, сервер ставит задачу механику.
  const maintenancePlans = make("maintenance_plans", [
    rel("company", companies.id, { required: true }),
    rel("vehicle", vehicles.id, { required: true, cascadeDelete: true }),
    text("name", { required: true, max: 200 }),
    num("interval_km", { min: 0, max: 1000000 }),
    num("interval_hours", { min: 0, max: 100000 }),
    int("interval_days", { min: 0, max: 3650 }),
    num("last_km", { min: 0, max: 10000000 }),
    num("last_hours", { min: 0, max: 1000000 }),
    date("last_date"),
    bool("active"),
    text("note", { max: 1000 }),
    created(), updated(),
  ], ["CREATE INDEX idx_maintenance_plans_vehicle ON maintenance_plans (company, vehicle)"]);

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
    // задача, поставленная сервером по плану ТО
    rel("maintenance_plan", maintenancePlans.id),
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
    // до какого дня показывать (например, «завтра выходной»); пусто — без срока
    date("until"),
    created(), updated(),
  ], ["CREATE INDEX idx_posts_company ON posts (company)"]);

  // ---------- документы: фото путевых, ТТН, актов, чеков ----------
  const documents = make("documents", [
    rel("company", companies.id, { required: true }),
    select("kind", ["waybill", "ttn", "act", "receipt", "photo", "epl", "etrn", "other"], { required: true }),
    {
      name: "files", type: "file", required: false, maxSelect: 10, maxSize: 15 * 1024 * 1024,
      mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"],
      thumbs: ["480x0"], protected: true,
    },
    rel("shift", shifts.id),
    rel("task", tasks.id),
    rel("vehicle", vehicles.id),
    rel("uploaded_by", users.id),
    text("number", { max: 100 }),
    date("doc_date"),
    // заготовка под ГИС ЭПД: идентификатор и состояние электронного документа (ЭПЛ, ЭТрН)
    text("external_id", { max: 100 }),
    select("external_status", ["draft", "sent", "signed", "rejected", "cancelled"]),
    text("note", { max: 1000 }),
    created(), updated(),
  ], [
    "CREATE INDEX idx_documents_company ON documents (company)",
    "CREATE INDEX idx_documents_shift ON documents (shift)",
  ]);

  // ---------- топливные карты: ПИН хранится зашифрованным и выдаётся отдельным запросом с записью в журнал ----------
  const fuelCards = make("fuel_cards", [
    rel("company", companies.id, { required: true }),
    text("number", { required: true, max: 32 }),
    text("provider", { max: 100 }),
    rel("vehicle", vehicles.id),
    rel("holder", memberships.id),
    num("limit_liters", { min: 0 }),
    date("valid_to"),
    bool("active"),
    text("pin_enc", { max: 500, hidden: true }),
    bool("pin_set"),
    text("note", { max: 1000 }),
    created(), updated(),
  ], ["CREATE INDEX idx_fuel_cards_company ON fuel_cards (company)"]);

  // ---------- заправки: по карте, за наличные, из своей ёмкости ----------
  const fuelLogs = make("fuel_logs", [
    rel("company", companies.id, { required: true }),
    rel("vehicle", vehicles.id, { required: true }),
    rel("member", memberships.id),
    rel("card", fuelCards.id),
    date("at", { required: true }),
    num("liters", { required: true, min: 0.1, max: 5000 }),
    int("amount_kop", { min: 0, max: 100000000 }),
    select("fuel", ["diesel", "ai92", "ai95", "gas", "other"]),
    select("source", ["card", "cash", "tank", "other"]),
    text("station", { max: 200 }),
    num("odometer", { min: 0, max: 10000000 }),
    num("engine_hours", { min: 0, max: 1000000 }),
    {
      name: "receipt", type: "file", required: false, maxSelect: 3, maxSize: 15 * 1024 * 1024,
      mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"],
      thumbs: ["480x0"], protected: true,
    },
    text("note", { max: 1000 }),
    rel("created_by", users.id),
    created(), updated(),
  ], [
    "CREATE INDEX idx_fuel_logs_company_at ON fuel_logs (company, at)",
    "CREATE INDEX idx_fuel_logs_vehicle_at ON fuel_logs (vehicle, at)",
  ]);

  // ---------- журнал ТО и ремонтов ----------
  const maintenanceLogs = make("maintenance_logs", [
    rel("company", companies.id, { required: true }),
    rel("vehicle", vehicles.id, { required: true }),
    rel("plan", maintenancePlans.id),
    rel("task", tasks.id),
    date("date", { required: true }),
    select("kind", ["service", "repair", "inspection", "tires", "other"], { required: true }),
    text("description", { max: 5000 }),
    num("odometer", { min: 0, max: 10000000 }),
    num("engine_hours", { min: 0, max: 1000000 }),
    int("cost_kop", { min: 0, max: 100000000 }),
    rel("performed_by", memberships.id),
    text("performer", { max: 200 }),
    rel("created_by", users.id),
    created(), updated(),
  ], ["CREATE INDEX idx_maintenance_logs_vehicle ON maintenance_logs (company, vehicle, date)"]);

  // ---------- график вахт (45×45 и любые другие) ----------
  const rotations = make("rotations", [
    rel("company", companies.id, { required: true }),
    rel("member", memberships.id, { required: true }),
    rel("site", sites.id),
    date("date_from", { required: true }),
    date("date_to", { required: true }),
    select("status", ["planned", "active", "done", "cancelled"], { required: true }),
    text("note", { max: 1000 }),
    rel("created_by", users.id),
    created(), updated(),
  ], [
    "CREATE INDEX idx_rotations_company ON rotations (company, date_from)",
    "CREATE INDEX idx_rotations_member ON rotations (member, date_from)",
  ]);

  // ---------- сообщения: общий чат компании, чат бригады объекта, обсуждение смены ----------
  const messages = make("messages", [
    rel("company", companies.id, { required: true }),
    rel("site", sites.id),
    rel("shift", shifts.id, { cascadeDelete: true }),
    rel("author", users.id),
    text("text", { required: true, max: 4000 }),
    created(), updated(),
  ], [
    "CREATE INDEX idx_messages_company ON messages (company, created)",
    "CREATE INDEX idx_messages_shift ON messages (shift)",
  ]);

  // ---------- журнал изменений денег и доступа ----------
  const auditLog = make("audit_log", [
    rel("company", companies.id),
    rel("actor", users.id),
    select("action", ["create", "update", "delete", "view"], { required: true }),
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

  rules(contracts, {
    listRule: role("company", OFFICE),
    viewRule: role("company", OFFICE),
    createRule: `${role("company", MGMT)} && customer.company = company`,
    updateRule: `${role("company", MGMT)} && @request.body.company:changed = false`,
    deleteRule: role("company", MGMT),
  });

  // позиции видят все: водитель выбирает, что делал («Подметание, п.м.»), но цен не видит
  rules(contractItems, {
    listRule: member("company"),
    viewRule: member("company"),
    createRule: `${role("company", MGMT)} && contract.company = company && (vehicle = "" || vehicle.company = company)`,
    updateRule: `${role("company", MGMT)} && @request.body.company:changed = false && @request.body.contract:changed = false`,
    deleteRule: role("company", MGMT),
  });

  rules(contractPrices, {
    listRule: role("company", MONEY),
    viewRule: role("company", MONEY),
    createRule: `${role("company", MGMT)} && item.company = company`,
    updateRule: `${role("company", MGMT)} && @request.body.company:changed = false && @request.body.item:changed = false`,
    deleteRule: role("company", MGMT),
  });

  // выручку пишет только сервер при подтверждении смены
  rules(shiftBills, {
    listRule: role("company", MONEY),
    viewRule: role("company", MONEY),
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });

  rules(fuelCards, {
    listRule: member("company"),
    viewRule: member("company"),
    createRule: `${role("company", MGMT)} && (vehicle = "" || vehicle.company = company) && (holder = "" || holder.company = company)`,
    updateRule: `${role("company", MGMT)} && @request.body.company:changed = false`,
    deleteRule: role("company", MGMT),
  });

  // график видят все в компании; ведут владелец, руководитель, диспетчер
  const PLAN = ["owner", "manager", "dispatcher"];
  // кто занимается техникой: ТО и ремонты
  const FLEET = ["owner", "manager", "mechanic"];
  const FLEET_SEE = ["owner", "manager", "dispatcher", "accountant", "mechanic"];

  // заправки: офис и механик видят все, водитель — свои; водитель вносит только свои и может
  // исправить или удалить их в течение суток, дальше — диспетчер или руководство
  rules(fuelLogs, {
    listRule: `(${role("company", FLEET_SEE)}) || member.user = @request.auth.id`,
    viewRule: `(${role("company", FLEET_SEE)}) || member.user = @request.auth.id`,
    createRule: `${member("company")} && vehicle.company = company && (card = "" || card.company = company) && ` +
      `(member = "" || member.company = company) && ((${role("company", PLAN)}) || member.user = @request.auth.id)`,
    updateRule: `@request.body.company:changed = false && ((${role("company", PLAN)}) || ` +
      `(${member("company")} && member.user = @request.auth.id && created_by = @request.auth.id && created >= @yesterday && ` +
      `@request.body.member:changed = false))`,
    deleteRule: `(${role("company", PLAN)}) || ` +
      `(${member("company")} && created_by = @request.auth.id && created >= @yesterday)`,
  });

  // план ТО видят все (водитель знает, что машине скоро ТО), ведут руководство и механик
  rules(maintenancePlans, {
    listRule: member("company"),
    viewRule: member("company"),
    createRule: role("company", FLEET),
    updateRule: `${role("company", FLEET)} && @request.body.company:changed = false && @request.body.vehicle:changed = false`,
    deleteRule: role("company", FLEET),
  });

  // журнал ТО с затратами — офис и механик
  rules(maintenanceLogs, {
    listRule: role("company", FLEET_SEE),
    viewRule: role("company", FLEET_SEE),
    createRule: `${role("company", FLEET)} && (plan = "" || plan.vehicle = vehicle)`,
    updateRule: `${role("company", FLEET)} && @request.body.company:changed = false && (plan = "" || plan.vehicle = vehicle)`,
    deleteRule: role("company", MGMT),
  });
  rules(rotations, {
    listRule: member("company"),
    viewRule: member("company"),
    createRule: `${role("company", PLAN)} && member.company = company && (site = "" || site.company = company)`,
    updateRule: `${role("company", PLAN)} && @request.body.company:changed = false`,
    deleteRule: role("company", PLAN),
  });

  // обсуждение смены видят те, кто видит смену; остальные чаты — все в компании
  const msgView = `(shift = "" && ${member("company")}) || (shift != "" && ((${role("company", OFFICE)}) || shift.member.user = @request.auth.id))`;
  rules(messages, {
    listRule: msgView,
    viewRule: msgView,
    createRule: `${member("company")} && (site = "" || site.company = company) && ` +
      `(shift = "" || (shift.company = company && ((${role("company", OFFICE)}) || shift.member.user = @request.auth.id)))`,
    updateRule: `author = @request.auth.id && @request.body.company:changed = false && ` +
      `@request.body.site:changed = false && @request.body.shift:changed = false`,
    deleteRule: `author = @request.auth.id || (${role("company", MGMT)})`,
  });

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
      `(contract = "" || contract.company = company) && ` +
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
    createRule: `shift.company = company && (vehicle = "" || vehicle.company = company) && ` +
      `(contract_item = "" || contract_item.company = company) && ${entryWrite}`,
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
  for (const name of ["audit_log", "messages", "rotations", "maintenance_logs", "fuel_logs", "fuel_cards", "documents",
    "posts", "task_events", "tasks", "maintenance_plans",
    "payouts", "adjustments", "shift_bills", "shift_entries", "shifts", "rate_factors", "rates", "sites",
    "contract_prices", "contract_items", "contracts", "customers", "vehicles", "memberships", "companies",
    "phone_checks"]) {
    app.delete(app.findCollectionByNameOrId(name));
  }
});
