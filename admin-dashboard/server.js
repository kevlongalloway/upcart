const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// The central dashboard is a single deployment at dashboard.upcart.online.
// At boot it calls /config to find the provisioning service, where merchants
// log in. Once authenticated, the SPA talks directly to that merchant's
// per-tenant store worker — the dashboard server itself proxies nothing.
const PROVISION_URL = (process.env.PROVISION_URL || 'https://provision.upcart.online').replace(/\/$/, '');
const BASE_DOMAIN   = process.env.BASE_DOMAIN   || 'upcart.online';
const SIGNUP_URL    = (process.env.SIGNUP_URL   || `https://${BASE_DOMAIN}`).replace(/\/$/, '');

app.use(express.static(path.join(__dirname, 'public')));

app.get('/config', (_req, res) => {
  res.json({
    provisionUrl: PROVISION_URL,
    signupUrl:    SIGNUP_URL,
    baseDomain:   BASE_DOMAIN,
  });
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// SPA fallback — every unknown route renders index.html so the hash router
// can take it from there.
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Upcart Dashboard listening on ${PORT} — provision=${PROVISION_URL}`);
});
