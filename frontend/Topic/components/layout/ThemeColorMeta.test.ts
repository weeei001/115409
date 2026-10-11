import assert from 'node:assert/strict';
import { SystemBarsStyle } from '@capacitor/core';
import { systemBarsStyle } from './ThemeColorMeta';

// Capacitor 的命名指底色：Dark 是深色底配淺色圖示，深色主題要用它（反過來會變成深底深字，看不見）
assert.equal(SystemBarsStyle.Dark, 'DARK');
assert.equal(systemBarsStyle('dark'), SystemBarsStyle.Dark);
assert.equal(systemBarsStyle('light'), SystemBarsStyle.Light);

console.log('System bars style passed: dark theme uses light icons, light theme uses dark icons.');
