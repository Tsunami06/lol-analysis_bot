/**
 * 投递：调 PowerShell 脚本驱动微信客户端发送
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from './config.mjs';

export async function sendToWechat({ group, text, delayMs = 600, mock = false }) {
  const tmpDir = path.join(ROOT, 'data', 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const file = path.join(tmpDir, `msg-${Date.now()}.txt`);
  fs.writeFileSync(file, text, 'utf8');

  const script = path.join(ROOT, 'sidecar', 'send-wechat.ps1');
  const args = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-Group', group,
    '-TextFile', file,
    '-DelayMs', String(delayMs),
  ];
  if (mock) args.push('-Mock');

  try {
    await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', args, { stdio: 'inherit', windowsHide: true });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`微信发送失败，PowerShell 退出码 ${code}`));
      });
    });
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* 忽略清理失败 */
    }
  }
}
