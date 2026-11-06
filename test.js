// Real-input headless test for Rolling Rush: Sky Tracks.
// Usage: node test.js <file-url> <outdir>
// Drives the game with real keyboard events and real mouse clicks at
// buttons' on-screen coordinates. See the notes inline for the two
// environment workarounds (rAF-less headless Chromium, slow CDP polls).
// The browser runs on a PERSISTENT profile so progress (localStorage save:
// max unlocked level, total coins) survives a relaunch; if the browser
// process dies mid-run (seen twice under heavy parallel VM load), the test
// relaunches and resumes the playthrough from the highest unlocked level.
const { chromium } = require('/home/hatch/workspace/tools/pw-shot/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');
const [url, outdir] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const profileDir = path.join(outdir, 'profile');
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail: detail || '' }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files', '--hatch-webgl-allowed-domains-file=/home/hatch/workspace/tools/pw-shot/webgl-policy.txt', '--hatch-webgl-allowed-domains-sha256=dc8a0e5eec744f6590a4c1889139c00568ffedc3eced6d0a1a5127e35f9ccd16'];

let page, context, errors = [];
async function launch() {
  context = await chromium.launchPersistentContext(profileDir, {
    headless: true, executablePath: '/opt/meta-chromium/chrome', args: LAUNCH_ARGS,
    viewport: { width: 480, height: 860 },
  });
  page = context.pages()[0] || await context.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200)); });
  await page.goto(url, { waitUntil: 'load' });
  await sleep(900);
}
async function close() { try { await context.close(); } catch (e) {} }

const state = () => page.evaluate(() => window.__rollingRush ? window.__rollingRush() : null);
// NOTE: plain page.click() is not used: in this headless Chromium build
// requestAnimationFrame never fires on its own, so Playwright's actionability
// "element stable" wait (which is rAF-based) never resolves. A coordinate
// mouse.click() is a genuine mouse press at the button's real position.
async function clickSel(sel) {
  const box = await page.locator(sel).boundingBox();
  if (!box) throw new Error('no bounding box for ' + sel);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
async function clickNth(sel, n) {
  const box = await page.locator(sel).nth(n).boundingBox();
  if (!box) throw new Error('no bounding box for ' + sel + ' #' + n);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
// Play driver: CDP evaluate round-trips in this environment take seconds
// (measured 1-9s under load), far too slow to steer a real-time game from
// Node. The driver therefore runs INSIDE the page on a 50ms timer,
// dispatching the exact keydown/keyup events the game listens for
// (ArrowRight held, Space to jump when a gap / rise / spike / mover is
// ahead). Menus use real Playwright mouse clicks; the fall test and the
// jump test below use real Playwright keyboard input.
async function startBot() {
  await page.evaluate(() => {
    if (window.__rrBot) return;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }));
    window.__rrBot = setInterval(() => {
      const s = window.__rollingRush(); if (!s || s.screen !== 'playing') return;
      // Gap / rise: full jump at the edge, full speed. The gap jump also
      // fires inside the coyote window (just rolled off an edge after a
      // late landing) — the game only honours it within 0.15s of leaving
      // the ground, so it can never become a mid-air double jump.
      const gapJump = !s.groundAhead55 && (s.ball.onGround || s.coyote);
      const riseJump = s.ball.onGround && s.riseAhead !== null && s.riseAhead < -25 && !s.groundAhead90;
      // The track ahead is too high to roll onto (ball's bottom is below
      // its surface) — jump, including inside the coyote window.
      const stepJump = (s.ball.onGround || s.coyote) && s.needJumpRise !== null && s.needJumpRise < -15;
      if (gapJump || riseJump || stepJump) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      // Spike / mover: SHORT hop at full speed (jump-cut 100ms after
      // pressing Space). Movers slide, so hop them earlier (<100px) than
      // spikes (<80px) — the mover can drift toward the landing spot
      // during the hop. Right stays held throughout — releasing it in the
      // air bleeds speed to friction and the hop lands on the hazard.
      // Spikes sit >=210px into >=370px tracks with >=130px after them,
      // so a full-speed cut hop lands comfortably past them.
      const hop = s.ball.onGround && ((s.spikeDist !== null && s.spikeDist < 80) || (s.moverDist !== null && s.moverDist < 100));
      if (hop && !window.__rrHopping) {
        window.__rrHopping = true;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
        setTimeout(() => { window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })); window.__rrHopping = false; }, 100);
      }
    }, 50);
  });
}
async function stopBot() {
  await page.evaluate(() => {
    if (window.__rrBot) { clearInterval(window.__rrBot); window.__rrBot = null; }
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowRight' }));
  });
}
async function waitScreen(want, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = await state();
    if (s && want.includes(s.screen)) return s;
    await sleep(500);
  }
  return await state();
}
async function playLevel(maxMs) {
  await startBot();
  const s = await waitScreen(['clear', 'win', 'over'], maxMs);
  await stopBot();
  return s;
}
// Play from the current screen until WIN (or give up after `guardMax`
// level attempts). Returns the final state. A level that game-overs 3
// times in a row stops the run (stuck) instead of retrying forever.
async function playthrough(guardMax) {
  let won = false, clears = 0, guard = 0, overStreak = 0, overLevel = 0, stuckLevel = 0;
  while (guard++ < guardMax) {
    let s = await state();
    if (!s) return { won, clears, s, stuckLevel };
    if (s.screen === 'win') { won = true; break; }
    if (s.screen === 'playing') {
      if (s.level === 10) await page.screenshot({ path: outdir + '/05-level10.png' }).catch(() => {});
      if (s.level === 20) await page.screenshot({ path: outdir + '/06-level20.png' }).catch(() => {});
      s = await playLevel(120000);
      if (s && s.screen === 'clear') { clears++; overStreak = 0; }
      else if (s && s.screen === 'over') {
        if (s.level === overLevel) overStreak++; else { overLevel = s.level; overStreak = 1; }
        if (overStreak >= 3) { stuckLevel = s.level; console.log('  STUCK on level ' + s.level + ' after 3 game-overs'); break; }
      }
      console.log('  level ' + (s ? s.level : '?') + ' -> ' + (s ? s.screen : 'no-state') + ' (clears so far ' + clears + ')');
    } else if (s.screen === 'clear') {
      await clickSel('#btn-next'); await sleep(400);
    } else if (s.screen === 'over') {
      await clickSel('#btn-retry'); await sleep(400);
    } else if (s.screen === 'menu') {
      // resume: open level select, start highest unlocked level
      const m = await state();
      await clickSel('#btn-levels'); await sleep(250);
      await clickNth('#levelsGrid .lv', (m.maxUnlocked || 1) - 1); await sleep(400);
    } else break;
  }
  const s = await state();
  return { won: won || (s && s.screen === 'win'), clears, s, stuckLevel };
}

(async () => {
  let won = false, finalScore = 0, playthroughDone = false;
  try {
    await launch();
    let s = await state();
    check('loads, hook present, menu screen', s && s.screen === 'menu', JSON.stringify(s));
    await page.screenshot({ path: outdir + '/01-menu.png' });

    await clickSel('#btn-how'); await sleep(250);
    const howVisible = await page.evaluate(() => !document.getElementById('howto').classList.contains('hidden'));
    check('how-to overlay opens', howVisible === true, 'howto visible=' + howVisible);
    await clickSel('#btn-how-close'); await sleep(200);

    await clickSel('#btn-start'); await sleep(400); s = await state();
    check('start -> playing level 1, 3 lives', s && s.screen === 'playing' && s.level === 1 && s.lives === 3, JSON.stringify(s));
    await page.screenshot({ path: outdir + '/02-level1.png' });

    // Jump test with REAL Playwright keyboard: press Space, watch the
    // game's jump counter increase (ball standing on the start track).
    const jumps0 = s.jumps;
    await page.keyboard.press('Space');
    let jumped = false;
    for (let i = 0; i < 20; i++) { await sleep(300); s = await state(); if (s.jumps > jumps0) { jumped = true; break; } }
    check('real keyboard Space makes Pip jump', jumped, 'jumps ' + jumps0 + ' -> ' + s.jumps);

    // Fall test: hold right (real keyboard), never jump -> ball falls in a
    // gap, loses 1 life, respawns.
    const lives0 = s.lives;
    await page.keyboard.down('ArrowRight');
    let fell = false;
    for (let i = 0; i < 80; i++) { await sleep(100); s = await state(); if (s.lives < lives0) { fell = true; break; } if (s.screen === 'clear') break; }
    await page.keyboard.up('ArrowRight');
    check('falling in a gap costs 1 life and respawns', fell && s.lives === lives0 - 1 && s.screen === 'playing', JSON.stringify(s));

    // Autopilot level 1 to clear
    s = await playLevel(120000);
    check('autopilot clears level 1 -> clear screen', s && s.screen === 'clear', JSON.stringify(s));
    await page.screenshot({ path: outdir + '/03-clear.png' });
    const scoreAfterL1 = s.score;

    await clickSel('#btn-next'); await sleep(400); s = await state();
    check('next -> playing level 2, score kept', s && s.screen === 'playing' && s.level === 2 && s.score === scoreAfterL1, JSON.stringify(s));

    await clickSel('#btn-pause'); await sleep(250); s = await state();
    check('pause -> paused screen', s.screen === 'paused', JSON.stringify(s));
    await page.screenshot({ path: outdir + '/04-paused.png' });
    await clickSel('#btn-resume'); await sleep(250); s = await state();
    check('resume -> playing', s.screen === 'playing', JSON.stringify(s));
    await clickSel('#btn-mute'); s = await state();
    check('mute toggles on', s.muted === true, JSON.stringify(s));
    await clickSel('#btn-mute'); s = await state();
    check('mute toggles off', s.muted === false, JSON.stringify(s));

    await clickSel('#btn-pause'); await sleep(200);
    await clickSel('#btn-pause-menu'); await sleep(250); s = await state();
    check('pause menu -> menu screen', s.screen === 'menu', JSON.stringify(s));
    await clickSel('#btn-levels'); await sleep(250);
    await clickNth('#levelsGrid .lv', 0); await sleep(400); s = await state();
    check('level select -> level 1 playing', s && s.screen === 'playing' && s.level === 1, JSON.stringify(s));

    // Full playthrough levels 1..20
    const pt = await playthrough(140);
    won = pt.won; finalScore = pt.s ? pt.s.score : 0;
    playthroughDone = pt.won; // only "done" on a win — a stuck run resumes
    check('full playthrough reaches WIN after 20 levels (clears=' + pt.clears + (pt.stuckLevel ? ', stuck at level ' + pt.stuckLevel : '') + ')', won, JSON.stringify(pt.s));
    await page.screenshot({ path: outdir + '/07-win.png' }).catch(() => {});

    if (won) {
      await clickSel('#btn-again'); await sleep(400); s = await state();
      check('play again -> level 1 playing, score reset', s && s.screen === 'playing' && s.level === 1 && s.score === 0, JSON.stringify(s));
    }
  } catch (e) {
    console.log('RUN INTERRUPTED (browser/target died?): ' + (e.message || e).toString().slice(0, 200));
  }
  // Resume path: if the playthrough never finished, relaunch on the
  // persistent profile and continue from the highest unlocked level.
  for (let attempt = 2; !playthroughDone && attempt <= 3; attempt++) {
    try { await close(); } catch (e) {}
    console.log('RESUME attempt ' + attempt + ': relaunching browser…');
    await sleep(3000);
    try {
      await launch();
      const pt = await playthrough(140);
      won = pt.won; finalScore = pt.s ? pt.s.score : 0; playthroughDone = pt.won;
      check('full playthrough reaches WIN after 20 levels (resume attempt ' + attempt + ', clears=' + pt.clears + (pt.stuckLevel ? ', stuck at level ' + pt.stuckLevel : '') + ')', won, JSON.stringify(pt.s));
      await page.screenshot({ path: outdir + '/07-win.png' }).catch(() => {});
      if (won) {
        await clickSel('#btn-again'); await sleep(400);
        const s = await state();
        check('play again -> level 1 playing, score reset', s && s.screen === 'playing' && s.level === 1 && s.score === 0, JSON.stringify(s));
      }
    } catch (e) {
      console.log('RESUME attempt ' + attempt + ' interrupted: ' + (e.message || e).toString().slice(0, 200));
    }
  }

  check('no page/console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed; final win score was ${finalScore}`);
  try { await close(); } catch (e) {}
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(2); });
