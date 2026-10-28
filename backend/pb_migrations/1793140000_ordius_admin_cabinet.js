/// <reference path="../pb_data/types.d.ts" />
// Кабинет Ordius: у заявки с сайта — статус работы с ней и заметка администратора.
migrate((app) => {
  const leads = app.findCollectionByNameOrId("leads");
  leads.fields.add(new SelectField({ name: "status", values: ["new", "in_work", "connected", "rejected"], maxSelect: 1 }));
  leads.fields.add(new TextField({ name: "admin_note", max: 500 }));
  app.save(leads);
}, (app) => {
  const leads = app.findCollectionByNameOrId("leads");
  leads.fields.removeByName("status");
  leads.fields.removeByName("admin_note");
  app.save(leads);
});
