// Техника: последние показания одометра и моточасов, план ТО и задачи механику.
// Расчёт сроков — чистая функция calc.maintenanceStatus; здесь чтение из базы и сохранение.

// Скачок показаний больше этого за одну запись — скорее опечатка: такие показания не принимаются
// как текущие (руководитель поправит вручную в карточке машины).
const MAX_JUMP_KM = 30000;
const MAX_JUMP_HOURS = 3000;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function vehicleName(v) {
  return [v.get("name"), v.get("plate")].filter(Boolean).join(" ");
}

// Поднять текущие показания машины, если новые больше. Возвращает true, если что-то изменилось.
function bumpReadings(app, vehicleId, km, hours) {
  if (!vehicleId || (!(km > 0) && !(hours > 0))) return false;
  let v = null;
  try { v = app.findRecordById("vehicles", vehicleId); } catch (_) { return false; }
  let changed = false;
  const nowKm = v.get("odometer_now") || 0;
  const nowH = v.get("engine_hours_now") || 0;
  if (km > nowKm && (nowKm === 0 || km - nowKm <= MAX_JUMP_KM)) { v.set("odometer_now", km); changed = true; }
  if (hours > nowH && (nowH === 0 || hours - nowH <= MAX_JUMP_HOURS)) { v.set("engine_hours_now", hours); changed = true; }
  if (!changed) return false;
  v.set("readings_at", new Date().toISOString().replace("T", " "));
  app.save(v);
  return true;
}

function planOf(r) {
  return {
    id: r.id, name: r.get("name"), vehicle: r.get("vehicle"), interval_km: r.get("interval_km"),
    interval_hours: r.get("interval_hours"), interval_days: r.get("interval_days"), last_km: r.get("last_km"),
    last_hours: r.get("last_hours"), last_date: r.getString("last_date"), active: r.get("active"),
  };
}

function readingsOf(v) {
  return { odometer_now: v.get("odometer_now"), engine_hours_now: v.get("engine_hours_now") };
}

function describe(st) {
  return st.parts.map((p) => {
    if (p.by === "days") return p.left <= 0 ? `срок прошёл ${p.next}` : `срок ${p.next}, осталось ${p.left} дн.`;
    return p.left <= 0 ? `перепробег ${-p.left} ${p.unit}` : `осталось ${p.left} ${p.unit} (ТО на ${p.next} ${p.unit})`;
  }).join("; ");
}

// Поставить механику задачу по каждому плану ТО, срок которого подошёл, если открытой задачи по нему ещё нет.
// filter — "vehicle = {:v}" и т. п.; без него — все активные планы на сервере (для расписания).
// calc — модуль lib/calc.js (передаётся вызывающим).
function syncMaintenanceTasks(app, calc, filter, params) {
  const plans = app.findRecordsByFilter("maintenance_plans", "active = true" + (filter ? " && " + filter : ""), "", 0, 0, params || {});
  const tasksCol = app.findCollectionByNameOrId("tasks");
  let created = 0;
  for (const p of plans) {
    let v = null;
    try { v = app.findRecordById("vehicles", p.get("vehicle")); } catch (_) { continue; }
    const st = calc.maintenanceStatus(planOf(p), readingsOf(v), today());
    if (st.status !== "soon" && st.status !== "overdue") continue;
    const open = app.findRecordsByFilter("tasks",
      "maintenance_plan = {:p} && status != 'done' && status != 'cancelled'", "", 1, 0, { p: p.id });
    if (open.length) {
      // задача уже есть: если срок прошёл — поднять приоритет
      if (st.status === "overdue" && open[0].get("priority") !== "high") { open[0].set("priority", "high"); app.save(open[0]); }
      continue;
    }
    const t = new Record(tasksCol);
    t.set("company", p.get("company"));
    t.set("title", `ТО: ${p.get("name")} — ${vehicleName(v)}`.slice(0, 200));
    t.set("description", (st.status === "overdue" ? "Просрочено: " : "Скоро: ") + describe(st));
    t.set("status", "new");
    t.set("priority", st.status === "overdue" ? "high" : "normal");
    t.set("assignee_role", "mechanic");
    t.set("vehicle", v.id);
    t.set("maintenance_plan", p.id);
    app.save(t);
    created++;
  }
  return created;
}

// Выполненное ТО по плану: сдвинуть «последнее выполнение» и закрыть открытые задачи по этому плану.
function applyLog(app, log, authId) {
  const planId = log.get("plan");
  if (!planId) return;
  let plan = null;
  try { plan = app.findRecordById("maintenance_plans", planId); } catch (_) { return; }
  let v = null;
  try { v = app.findRecordById("vehicles", log.get("vehicle")); } catch (_) { /* нет */ }
  const km = log.get("odometer") || (v ? v.get("odometer_now") : 0) || 0;
  const hours = log.get("engine_hours") || (v ? v.get("engine_hours_now") : 0) || 0;
  const date = log.getString("date");
  if (!plan.getString("last_date") || date >= plan.getString("last_date")) {
    if (km > 0) plan.set("last_km", km);
    if (hours > 0) plan.set("last_hours", hours);
    plan.set("last_date", date);
    app.save(plan);
  }
  const events = app.findCollectionByNameOrId("task_events");
  for (const t of app.findRecordsByFilter("tasks", "maintenance_plan = {:p} && status != 'done' && status != 'cancelled'",
    "", 0, 0, { p: planId })) {
    const from = t.get("status");
    t.set("status", "done");
    t.set("closed_at", new Date().toISOString().replace("T", " "));
    app.save(t);
    const ev = new Record(events);
    ev.set("company", t.get("company"));
    ev.set("task", t.id);
    ev.set("author", authId || "");
    ev.set("kind", "status");
    ev.set("from_status", from);
    ev.set("to_status", "done");
    ev.set("text", "ТО внесено в журнал");
    app.save(ev);
  }
}

module.exports = { today, vehicleName, bumpReadings, planOf, readingsOf, syncMaintenanceTasks, applyLog };
