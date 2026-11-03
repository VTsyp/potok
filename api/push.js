const webpush = require('web-push');

const MAX_SUBSCRIPTIONS = 100;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'https://potok-ys2h.vercel.app';

  if (!publicKey || !privateKey) {
    res.status(500).json({ error: 'push_not_configured' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'bad_request' });
    return;
  }

  const subscriptions = Array.isArray(body.subscriptions)
    ? body.subscriptions.slice(0, MAX_SUBSCRIPTIONS)
    : [];

  if (!subscriptions.length) {
    res.status(200).json({ sent: 0, failed: 0 });
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const payload = JSON.stringify({
    title: String(body.title || 'Поток'),
    body: String(body.body || 'В общем потоке новые изменения'),
    url: String(body.url || '/'),
    tag: String(body.tag || 'potok-update'),
  });

  let sent = 0;
  let failed = 0;

  await Promise.all(subscriptions.map(async function (item) {
    if (!item || !item.endpoint || !item.p256dh || !item.auth) return;

    try {
      await webpush.sendNotification({
        endpoint: item.endpoint,
        keys: { p256dh: item.p256dh, auth: item.auth },
      }, payload, { TTL: 3600, urgency: 'normal' });
      sent += 1;
    } catch (error) {
      failed += 1;
      if (error && error.statusCode !== 404 && error.statusCode !== 410) {
        console.warn('Potok push failed:', error.statusCode || error.message);
      }
    }
  }));

  res.status(200).json({ sent, failed });
};
