/* NexOS task-alert push subscription client. */
(function attachSharedPushClient() {
  function decodeApplicationKey(base64UrlKey) {
    const base64 = String(base64UrlKey || '').replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  async function enableSharedPush() {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      throw new Error('This browser does not support background push notifications. Try installing the app in Chrome or Edge on Android/desktop.');
    }
    if (!window.isSecureContext) throw new Error('Push notifications require HTTPS.');

    const configResponse = await fetch('/api/push/config', { credentials: 'same-origin', cache: 'no-store' });
    if (!configResponse.ok) throw new Error('Could not read notification settings from the server.');
    const config = await configResponse.json();
    if (!config.enabled || !config.publicKey) {
      throw new Error('Background task alerts are not configured on the server yet. NexOS needs its VAPID keys configured first.');
    }

    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission was not granted. Check this site’s browser settings.');

    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    const applicationServerKey = decodeApplicationKey(config.publicKey);
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const currentKey = subscription.options && subscription.options.applicationServerKey;
      const sameKey = currentKey && currentKey.byteLength === applicationServerKey.byteLength
        && applicationServerKey.every((byte, index) => byte === new Uint8Array(currentKey)[index]);
      if (!sameKey) {
        await subscription.unsubscribe();
        subscription = null;
      }
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    const saveResponse = await fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    const savePayload = await saveResponse.json().catch(() => ({}));
    if (!saveResponse.ok) throw new Error(savePayload.error || 'Could not save the push subscription.');

    // A test push confirms the browser, subscription, server keys and push service cooperate.
    const testResponse = await fetch('/api/push/test', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const testPayload = await testResponse.json().catch(() => ({}));
    if (!testResponse.ok) throw new Error(testPayload.error || 'Subscription saved, but the test notification failed.');
    return { ok: true, testSent: true };
  }

  async function disableSharedPush() {
    if (!('serviceWorker' in navigator)) return { ok: true };
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) return { ok: true };
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return { ok: true };
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await fetch('/api/push/subscribe', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {});
    return { ok: true };
  }

  window.enableSharedPush = enableSharedPush;
  window.disableSharedPush = disableSharedPush;
})();
