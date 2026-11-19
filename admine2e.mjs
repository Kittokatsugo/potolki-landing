import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const out = [];
const ok = (n, c, e = '') => { c ? (pass++, out.push(`  OK   ${n}`)) : (fail++, out.push(`  FAIL ${n} ${e}`)); };

// берём пароль из файла
const pwdFile = fs.readFileSync('data/admin-password.txt', 'utf8');
const password = pwdFile.match(/Пароль:\s*(\S+)/)[1];
console.log('Пароль из файла:', password);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

/* --- Редирект без входа --- */
await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });
ok('без входа /admin редиректит на логин', page.url().includes('/admin/login'), page.url());

/* --- Неверный пароль --- */
await page.fill('#password', 'wrongpassword');
await page.click('#submitBtn');
await page.waitForTimeout(700);
ok('неверный пароль отклонён', await page.locator('#err').isVisible());
ok('остались на странице входа', page.url().includes('/admin/login'));

/* --- Верный пароль --- */
await page.fill('#password', password);
await page.click('#submitBtn');
await page.waitForTimeout(1200);
ok('вход с верным паролем', page.url().endsWith('/admin'), page.url());
ok('нет JS-ошибок в админке', errors.length === 0, errors.join(' | '));

/* --- Заявки на месте --- */
const cards = await page.locator('.card').count();
ok('заявки отображаются', cards >= 2, `найдено ${cards}`);

const firstPhone = await page.locator('.card__phone').first().textContent();
ok('телефон отформатирован', /^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/.test(firstPhone.trim()), firstPhone);

const telHref = await page.locator('.card__phone').first().getAttribute('href');
ok('телефон кликабелен (tel:)', telHref.startsWith('tel:+7'), telHref);

/* --- Статистика --- */
const statsCount = await page.locator('.stat').count();
ok('блок статистики есть', statsCount === 4, `блоков ${statsCount}`);
const total = await page.locator('.stat').last().locator('.stat__value').textContent();
ok('всего заявок >= 2', Number(total) >= 2, `всего ${total}`);

/* --- Смена статуса --- */
const cardBefore = page.locator('.card').first();
const idBefore = await cardBefore.locator('.card__id').textContent();
await cardBefore.locator('[data-set-status="in_progress"]').click();
await page.waitForTimeout(900);
const statusAfter = await page.locator('.card').first().locator('.st').textContent();
ok('статус меняется на «В работе»', statusAfter.includes('В работе'), statusAfter);

/* --- Фильтры --- */
await page.locator('.chip[data-status="in_progress"]').click();
await page.waitForTimeout(700);
const inProgressCards = await page.locator('.card').count();
ok('фильтр «В работе» показывает заявку', inProgressCards >= 1, `${inProgressCards}`);

await page.locator('.chip[data-status="rejected"]').click();
await page.waitForTimeout(700);
const rejectedEmpty = await page.locator('.empty').count();
ok('фильтр «Отказы» пустой', rejectedEmpty === 1);

await page.locator('.chip[data-status="all"]').click();
await page.waitForTimeout(700);

/* --- Мобильная админка --- */
const mobile = await ctx.newPage();
await mobile.setViewportSize({ width: 375, height: 800 });
await mobile.goto(BASE + '/admin', { waitUntil: 'networkidle' });
await mobile.waitForTimeout(800);
const docW = await mobile.evaluate(() => document.documentElement.scrollWidth);
ok('админка адаптивна на 375px', docW <= 377, `scrollWidth=${docW}`);
await mobile.screenshot({ path: 'screens/admin-mobile.png', fullPage: true });

/* --- Выход --- */
await page.locator('#logoutBtn').click();
await page.waitForTimeout(900);
ok('выход работает', page.url().includes('/admin/login'), page.url());

await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });
ok('после выхода /admin снова заблокирован', page.url().includes('/admin/login'));

await page.screenshot({ path: 'screens/admin-login.png' });
await browser.close();

console.log('\n' + out.join('\n'));
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
