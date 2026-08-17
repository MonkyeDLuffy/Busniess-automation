let cachedApp = null;

export default async function handler(req, res) {
  try {
    if (!cachedApp) {
      const { default: app } = await import('../src/app.js');
      cachedApp = app;
    }
    return cachedApp(req, res);
  } catch (e) {
    res.status(500).json({ error: e?.stack || String(e) });
  }
}
