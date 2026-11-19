import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:3000/';
let pass = 0, fail = 0;
const results = [];

function ok(name, cond, extra = '') {
  if (cond) { pass++; results.push(`  OK   ${name}`); }
  else { fail++; results.push(`  FAIL ${name} ${extra}`); }
}

const browser = await chromium.launch();

/* ========== DESKTOP ========== */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle' });

  ok('страница загрузилась', (await page.title()).includes('Натяжные потолки'));
  ok('нет JS-ошибок', errors.length === 0, errors.join(' | '));
  ok('один h1', (await page.locator('h1').count()) === 1);
  ok('есть meta description', !!(await page.locator('meta[name="description"]').getAttribute('content')));
  ok('есть favicon', (await page.locator('link[rel="icon"]').count()) === 1);

  // alt у картинок
  const imgs = await page.locator('img').all();
  let noAlt = 0, noDim = 0;
  for (const img of imgs) {
    const alt = await img.getAttribute('alt');
    const w = await img.getAttribute('width');
    const h = await img.getAttribute('height');
    if (!alt) noAlt++;
    if (!w || !h) noDim++;
  }
  ok(`все img имеют alt (${imgs.length})`, noAlt === 0, `без alt: ${noAlt}`);
  ok('все img имеют width/height', noDim === 0, `без размеров: ${noDim}`);

  // Квиз: шаг 1
  ok('квиз на шаге 1', (await page.locator('#quizStep').textContent()).includes('Шаг 1'));
  const optCount1 = await page.locator('#quizOptions .opt').count();
  ok('на шаге 1 есть варианты', optCount1 === 4, `найдено ${optCount1}`);

  // Проходим квиз: 15-25 м² -> Глянцевый -> 4 светильника
  await page.locator('#quizOptions .opt').nth(1).click(); // 15–25 м²
  await page.waitForTimeout(300);
  ok('шаг 2 после выбора', (await page.locator('#quizStep').textContent()).includes('Шаг 2'));

  const typeLabels = await page.locator('#quizOptions .opt').allTextContents();
  const glossIdx = typeLabels.findIndex(t => t.includes('Глянцевый'));
  await page.locator('#quizOptions .opt').nth(glossIdx).click();
  await page.waitForTimeout(300);
  ok('шаг 3 после выбора типа', (await page.locator('#quizStep').textContent()).includes('Шаг 3'));

  const lightLabels = await page.locator('#quizOptions .opt').allTextContents();
  const fourIdx = lightLabels.findIndex(t => t.includes('4 светильника'));
  await page.locator('#quizOptions .opt').nth(fourIdx).click();
  await page.waitForTimeout(400);

  ok('результат показан', await page.locator('#quizResult').isVisible());
  const sumText = await page.locator('#quizSum').textContent();
  // 22 * 450 * 0.97 = 9603 + 1800 = 11403
  ok('цена посчитана верно', sumText.replace(/\s/g, '') === '11403₽', `получено: ${sumText}`);

  // Валидация: короткий телефон
  await page.locator('#qPhone').fill('+7 (978) 12');
  await page.locator('#quizSubmit').click();
  await page.waitForTimeout(200);
  ok('короткий телефон отклонён', await page.locator('#qPhoneErr').isVisible());

  // Валидный телефон -> демо-отправка
  await page.locator('#qPhone').fill('9781234567');
  const masked = await page.locator('#qPhone').inputValue();
  ok('маска телефона работает', masked === '+7 (978) 123-45-67', `получено: ${masked}`);

  await page.locator('#qName').fill('Тест');
  await page.locator('#quizSubmit').click();
  await page.waitForTimeout(600);
  ok('заявка отправлена', await page.locator('#toast').isVisible());

  // После успешной отправки квиз сбрасывается на шаг 1
  await page.waitForTimeout(700);
  ok('квиз сбросился на шаг 1', (await page.locator('#quizStep').textContent()).includes('Шаг 1'));

  // Cookie
  ok('cookie-баннер показан', await page.locator('#cookie').isVisible());
  await page.locator('#cookieOk').click();
  await page.waitForTimeout(300);
  ok('cookie закрывается', !(await page.locator('#cookie').isVisible()));

  // Модалка политики
  await page.locator('.footer [data-privacy]').first().click();
  await page.waitForTimeout(200);
  ok('модалка политики открывается', await page.locator('#modal').isVisible());
  await page.locator('#modalClose').click();
  await page.waitForTimeout(200);
  ok('модалка закрывается', !(await page.locator('#modal').isVisible()));

  // ---- Gallery before/after ----
  ok('галерея: 4 блока до/после', (await page.locator('.ba').count()) === 4);
  ok('галерея: у каждого 2 картинки', (await page.locator('.ba .ba__img').count()) === 8);
  ok('галерея: 4 пары до/после в разметке', (await page.locator('.ba__tag--before').count()) === 4 && (await page.locator('.ba__tag--after').count()) === 4);

  // ползунок двигается
  await page.locator('.ba').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const stage = page.locator('.ba__stage').first();
  const sbox = await stage.boundingBox();
  const clipBefore = await page.locator('.ba__after').first().evaluate(e => e.style.clipPath);
  await page.mouse.move(sbox.x + sbox.width * 0.5, sbox.y + sbox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(sbox.x + sbox.width * 0.2, sbox.y + sbox.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const clipAfter = await page.locator('.ba__after').first().evaluate(e => e.style.clipPath);
  ok('галерея: ползунок двигает границу', clipBefore !== clipAfter, `${clipBefore} -> ${clipAfter}`);

  // лайтбокс
  await page.locator('.ba__zoom').first().click();
  await page.waitForTimeout(300);
  ok('лайтбокс открывается', await page.locator('#lightbox').isVisible());
  const lbSrc = await page.locator('#lbImg').getAttribute('src');
  ok('лайтбокс показывает картинку', !!lbSrc && lbSrc.includes('.webp'), lbSrc);
  await page.locator('#lbNext').click();
  await page.waitForTimeout(200);
  ok('лайтбокс: следующее фото', (await page.locator('#lbImg').getAttribute('src')) !== lbSrc);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('лайтбокс закрывается по Esc', !(await page.locator('#lightbox').isVisible()));

  await page.screenshot({ path: 'screens/desktop.png', fullPage: true });
  await page.close();
}

/* ========== MOBILE 375 ========== */
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const overflow = await page.evaluate(() => {
    const bad = [];
    const vw = window.innerWidth;
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > vw + 2 || r.left < -2)) {
        const st = getComputedStyle(el);
        if (st.position === 'fixed') return;
        bad.push(`${el.tagName}.${el.className?.toString().slice(0,40)} right=${Math.round(r.right)}`);
      }
    });
    return bad.slice(0, 8);
  });
  ok('375px: нет горизонтального выезда', overflow.length === 0, overflow.join(' ; '));

  const docW = await page.evaluate(() => document.documentElement.scrollWidth);
  ok('375px: документ не шире экрана', docW <= 377, `scrollWidth=${docW}`);

  ok('375px: мобильная панель видна', await page.locator('.mobile-bar').isVisible());
  await page.screenshot({ path: 'screens/mobile.png', fullPage: true });
  await page.close();
}

/* ========== 320 ========== */
{
  const page = await browser.newPage({ viewport: { width: 320, height: 700 } });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const docW = await page.evaluate(() => document.documentElement.scrollWidth);
  ok('320px: документ не шире экрана', docW <= 322, `scrollWidth=${docW}`);
  await page.close();
}

await browser.close();

console.log('\n' + results.join('\n'));
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
