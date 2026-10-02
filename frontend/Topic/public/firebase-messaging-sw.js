/* Firebase web configuration is public and supplied by the client build. */
self.addEventListener('notificationclick', (event) => {
  event.stopImmediatePropagation();
  event.notification.close();
  const raw = event.notification.data?.FCM_MSG?.data?.url || '/me#notifications';
  let target = new URL('/me#notifications', self.location.origin);
  try {
    const candidate = new URL(raw, self.location.origin);
    if (candidate.origin === self.location.origin) target = candidate;
  } catch { /* Use the inbox for invalid links. */ }
  event.waitUntil(clients.openWindow(target.href));
});
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');
const config = JSON.parse(new URL(self.location.href).searchParams.get('config'));
firebase.initializeApp(config);
firebase.messaging();
