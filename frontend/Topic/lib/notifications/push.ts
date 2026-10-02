import { Capacitor } from '@capacitor/core';
import { registerNotificationDevice, unregisterNotificationDevice } from '../api/notifications';
import { getToken as getAuthToken, getStoredUser } from '../auth/storage';
import { safeReturnUrl } from '../utils/returnUrl';
import { DEVICE_KEY } from './session';

export const PUSH_EVENT = 'topic-push-message';
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
export function pushConfigured() {
  return Capacitor.getPlatform() === 'android'
    ? process.env.NEXT_PUBLIC_ANDROID_PUSH_ENABLED === 'true'
    : Object.values(firebaseConfig).every(Boolean) && Boolean(process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY);
}
export function deviceEnabled() {
  if (typeof window === 'undefined') return false;
  try { return JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null')?.owner === getStoredUser()?.id; }
  catch { return false; }
}
function emit(title?: string, body?: string, url?: string) {
  window.dispatchEvent(new CustomEvent(PUSH_EVENT, { detail: { title, body, url: safeReturnUrl(url) || '/favorites#notifications' } }));
}
async function messaging() {
  const [{ initializeApp, getApps }, { getMessaging, isSupported }] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
  if (!await isSupported()) throw new Error('此瀏覽器不支援推播通知，仍可在這裡查看通知。');
  return getMessaging(getApps().find((app) => app.name === 'notifications') || initializeApp(firebaseConfig, 'notifications'));
}
async function webToken(): Promise<string> {
  const { getToken } = await import('firebase/messaging');
  const worker = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?config=${encodeURIComponent(JSON.stringify(firebaseConfig))}`);
  await navigator.serviceWorker.ready;
  return getToken(await messaging(), { vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY, serviceWorkerRegistration: worker });
}
let listeners: Promise<() => void> | undefined;
export async function listenForPush(): Promise<() => void> {
  if (!pushConfigured()) return () => {};
  if (!listeners) listeners = (async () => {
    if (Capacitor.getPlatform() === 'android') {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const received = await PushNotifications.addListener('pushNotificationReceived', (message) => emit(message.title, message.body, message.data?.url));
      const action = await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
        window.location.assign(safeReturnUrl(notification.data?.url) || '/favorites#notifications');
      });
      return () => { void received.remove(); void action.remove(); };
    }
    const { onMessage } = await import('firebase/messaging');
    return onMessage(await messaging(), (message) => emit(message.notification?.title, message.notification?.body, message.data?.url));
  })().catch((error) => { listeners = undefined; throw error; });
  return listeners;
}
async function androidToken(requestPermission = true): Promise<string> {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const permission = requestPermission ? await PushNotifications.requestPermissions() : await PushNotifications.checkPermissions();
  if (permission.receive !== 'granted') throw new Error('請在系統設定中允許通知。');
  return new Promise((resolve, reject) => {
    const handles: { remove(): Promise<void> }[] = [];
    const timer = setTimeout(() => finish(new Error('取得推播註冊資料逾時，請重試。')), 20000);
    const finish = (error?: Error, token?: string) => {
      clearTimeout(timer);
      handles.forEach((handle) => void handle.remove());
      if (error) reject(error); else resolve(token!);
    };
    void (async () => {
      handles.push(await PushNotifications.addListener('registration', ({ value }) => finish(undefined, value)));
      handles.push(await PushNotifications.addListener('registrationError', () => finish(new Error('推播註冊失敗，請稍後重試。'))));
      await PushNotifications.register();
    })().catch((error) => finish(error));
  });
}
export async function enablePush() {
  if (!pushConfigured()) throw new Error('推播服務尚未設定完成。');
  const auth = getAuthToken();
  const owner = getStoredUser()?.id;
  if (!auth || !owner) throw new Error('請先登入。');
  let token: string;
  const platform = Capacitor.getPlatform() === 'android' ? 'android' : 'web';
  if (platform === 'android') token = await androidToken();
  else {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('此瀏覽器不支援推播通知。');
    if (await Notification.requestPermission() !== 'granted') throw new Error('請在瀏覽器網站設定中允許通知。');
    token = await webToken();
  }
  if (auth !== getAuthToken() || owner !== getStoredUser()?.id) throw new Error('帳號已變更，請重新啟用通知。');
  await registerNotificationDevice(token, platform, auth);
  if (auth !== getAuthToken() || owner !== getStoredUser()?.id) {
    await unregisterNotificationDevice(token, auth);
    throw new Error('帳號已變更，請重新啟用通知。');
  }
  localStorage.setItem(DEVICE_KEY, JSON.stringify({ token, owner, platform }));
  await listenForPush();
}
let refreshPending: Promise<void> | undefined;
/** Renew only a prior opt-in; never opens a permission prompt. */
export function refreshPushRegistration(): Promise<void> {
  if (refreshPending) return refreshPending;
  refreshPending = (async () => {
    if (!pushConfigured() || !deviceEnabled()) return;
    const auth = getAuthToken();
    const owner = getStoredUser()?.id;
    if (!auth || !owner) return;
    const platform = Capacitor.getPlatform() === 'android' ? 'android' : 'web';
    if (platform === 'web' && (!('Notification' in window) || Notification.permission !== 'granted')) return;
    const token = platform === 'android' ? await androidToken(false) : await webToken();
    if (auth !== getAuthToken() || owner !== getStoredUser()?.id || !deviceEnabled()) return;
    const previous = JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null');
    await registerNotificationDevice(token, platform, auth);
    if (auth !== getAuthToken() || owner !== getStoredUser()?.id || !deviceEnabled()) {
      await unregisterNotificationDevice(token, auth);
      return;
    }
    localStorage.setItem(DEVICE_KEY, JSON.stringify({ token, owner, platform }));
    if (previous?.token && previous.token !== token) await unregisterNotificationDevice(previous.token, auth);
  })().finally(() => { refreshPending = undefined; });
  return refreshPending;
}
export async function disablePush() {
  const raw = localStorage.getItem(DEVICE_KEY);
  if (!raw) return;
  const { token, platform } = JSON.parse(raw);
  await unregisterNotificationDevice(token);
  await revokePushToken(platform);
  localStorage.removeItem(DEVICE_KEY);
}
export async function revokePushToken(platform: string) {
  if (platform === 'android') {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.unregister();
  } else {
    const { deleteToken } = await import('firebase/messaging');
    await deleteToken(await messaging());
  }
}
