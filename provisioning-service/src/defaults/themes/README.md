# Theme catalog (provisioning mirror)

These `*.theme.json` files are a **committed mirror** of the editor's built-in
themes in
[`admin-dashboard/editor-app/src/themes/`](../../../../admin-dashboard/editor-app/src/themes).

The editor is the **authoring source**. This copy lets the provisioning Worker:

- seed a new tenant's `store_settings.page_sections` with the signup-chosen
  theme (`routes/provision.ts`), and
- serve the central theme-catalog API (`routes/themes.ts`: `GET /themes`,
  `GET /themes/:id`)

without a cross-app TypeScript import.

**Keep the two directories in sync.** When you add or change a theme in the
editor, copy the JSON here:

```sh
cp admin-dashboard/editor-app/src/themes/*.theme.json \
   provisioning-service/src/defaults/themes/
```

Themes are authored sparsely — the storefront renderer fills visible defaults
for any missing field, and opening the editor (which normalizes against the
section registry) + Save upgrades the stub to the full schema.
