/**
 * 🔑 超级管理员 CLI 创建工具
 * ============================================================
 * 参考 Django manage.py createsuperuser / Strapi 首次启动向导
 *
 * 用法:
 *   本地开发:  yarn workspace @lucky/api create-admin
 *   生产容器:  docker exec -it lucky-backend-prod \
 *                node apps/api/dist/scripts/cli/create-admin.js
 * ============================================================
 */

/**
 * 🔑 超级管理员 CLI 创建工具
 * ============================================================
 * 参考 Django manage.py createsuperuser / Strapi 首次启动向导
 *
 * 用法:
 *   本地开发:  yarn workspace @lucky/api create-admin
 *   生产容器:  docker exec -it lucky-backend-prod \
 *                node apps/api/dist/scripts/cli/create-admin.js
 * ============================================================
 */
import * as readline from 'readline';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { Role } from '@lucky/shared';
import { loadEnvForHost } from '../utils/load-env-for-host';

loadEnvForHost(); // ← 必须在 new PrismaClient() 前执行

const db = new PrismaClient();

// ── 工具: 普通文本输入 ──────────────────────────────────────────
function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

// ── 工具: 密码输入 (TTY 下屏蔽回显，显示 * 号) ──────────────────
function askPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    // ① TTY 模式 — 原始模式逐字符处理
    if (process.stdout.isTTY && process.stdin.isTTY) {
      process.stdout.write(question);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      let password = '';
      const handler = (ch: string) => {
        // Enter / Ctrl-D → 结束输入
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', handler);
          process.stdout.write('\n');
          resolve(password);
          return;
        }
        // Ctrl-C → 退出
        if (ch === '\u0003') {
          process.stdout.write('\n');
          void db.$disconnect().then(() => process.exit(0));
          return;
        }
        // Backspace
        if (ch === '\u007F') {
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
            process.stdout.write(question + '*'.repeat(password.length));
          }
          return;
        }
        password += ch;
        process.stdout.write('*');
      };
      process.stdin.on('data', handler);
    } else {
      // ② 非 TTY (管道/CI) — 直接读取明文
      const rl2 = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl2.question(question, (answer) => {
        rl2.close();
        resolve(answer.trim());
      });
    }
  });
}

// ── 主逻辑 ──────────────────────────────────────────────────────
async function main() {
  console.log('\n🔑  Lucky Admin — 超级管理员创建工具');
  console.log('=========================================');
  console.log('  类似 Django manage.py createsuperuser');
  console.log('  按 Ctrl+C 随时退出\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // ── Step 1: 用户名 ─────────────────────────────────────────────
  let username = '';
  while (!username) {
    username = await ask(rl, '用户名 (Username): ');
    if (!username) {
      console.log('  ❌ 用户名不能为空\n');
    } else if (!/^[a-zA-Z0-9_]{3,50}$/.test(username)) {
      console.log('  ❌ 只能包含字母、数字、下划线，长度 3-50 字符\n');
      username = '';
    }
  }

  // 检查用户是否已存在
  const existing = await db.adminUser.findUnique({ where: { username } });
  if (existing) {
    console.log(`\n  ⚠️  用户 "${username}" 已存在！`);
    const confirm = await ask(rl, '  是否重置密码并更新信息? [y/N]: ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('\n  已取消，未作任何修改。\n');
      rl.close();
      await db.$disconnect();
      return;
    }
    console.log('');
  }

  // ── Step 2: 显示名称 (可选) ───────────────────────────────────
  const rawName = await ask(rl, '显示名称 (Real name, 回车跳过): ');
  const realName = rawName || '超级管理员';
  rl.close();

  // ── Step 3: 密码 (隐藏输入 + 二次确认) ──────────────────────────
  let password = '';
  while (!password) {
    const pw1 = await askPassword('密码 (Password):          ');
    if (pw1.length < 8) {
      console.log('  ❌ 密码至少 8 位\n');
      continue;
    }
    const pw2 = await askPassword('确认密码 (Confirm):       ');
    if (pw1 !== pw2) {
      console.log('  ❌ 两次密码不一致，请重新输入\n');
    } else {
      password = pw1;
    }
  }

  // ── Step 4: 写入数据库 ─────────────────────────────────────────
  console.log('\n→ 加密密码并写入数据库...');
  const hashedPassword = await bcrypt.hash(password, 12);

  const admin = await db.adminUser.upsert({
    where: { username },
    update: {
      password: hashedPassword,
      realName,
      role: Role.SUPER_ADMIN, // ← 必须同步更新 role，否则旧 ADMIN 账号重置后仍无 SUPER_ADMIN 权限
      updatedAt: new Date(),
    },
    create: {
      // id 由 Prisma @default(cuid()) 自动生成
      username,
      password: hashedPassword,
      realName,
      role: Role.SUPER_ADMIN,
      status: 1,
    },
  });

  const verb = existing ? '已更新' : '已创建';
  console.log(`\n✅ 管理员账号${verb}！`);
  console.log('─────────────────────────────');
  console.log(`  ID       : ${admin.id}`);
  console.log(`  用户名   : ${admin.username}`);
  console.log(`  显示名称 : ${admin.realName ?? '—'}`);
  console.log(`  角色     : ${admin.role}`);
  console.log(`  状态     : ${admin.status === 1 ? '启用' : '禁用'}`);
  console.log('─────────────────────────────');
  console.log('\n🎉 现在可以登录后台了！\n');

  await db.$disconnect();
}

main().catch(async (err: Error) => {
  console.error('\n❌ 操作失败:', err.message);
  await db.$disconnect();
  process.exit(1);
});
