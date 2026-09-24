/* ---------------------------------------------------------
   Light agent diagnostics.   Run:  npm run check-ai

   Checks, in order, every link between the store and the AI:
     1. Is Ollama running and reachable?
     2. Which models are installed, and which one will Light use?
     3. Can that model actually answer, and how fast?
   Then prints exactly what to do if something is wrong.
--------------------------------------------------------- */
require('dotenv').config();
const { checkAgentAvailable, askAgent, retrieveProducts, OLLAMA_URL, CONFIGURED_MODEL, NUM_CTX } = require('./agent');

const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => console.log('  ❌ ' + m);
const info = (m) => console.log('     ' + m);

(async () => {
  console.log('\n=== فحص مساعد لايت (Light agent check) ===\n');
  console.log(`  Ollama address : ${OLLAMA_URL}`);
  console.log(`  Model in .env  : ${CONFIGURED_MODEL}`);
  console.log(`  Context window : ${NUM_CTX} tokens\n`);

  // 1 + 2 — reachability and models
  const status = await checkAgentAvailable();
  if (!status.reachable) {
    bad('Ollama is NOT reachable.');
    info('Fix: install Ollama from https://ollama.com/download and make sure it is running.');
    info('     On Windows it runs from the system tray; you can also run:  ollama serve');
    info(`     (details: ${status.error})`);
    return finish(false);
  }
  ok('Ollama is running.');

  if (!status.installedModels.length) {
    bad('Ollama has NO models installed.');
    info('Fix: run one of these, then run this check again:');
    info('     ollama pull qwen2.5:3b     (recommended for most PCs, good Arabic)');
    info('     ollama pull llama3.1       (bigger, needs ~8 GB of free RAM)');
    return finish(false);
  }
  ok(`Installed models: ${status.installedModels.join(', ')}`);

  if (status.usingFallbackModel) {
    console.log(`  ⚠️  "${CONFIGURED_MODEL}" is not installed — Light will use "${status.model}" instead.`);
    info(`To silence this, set  OLLAMA_MODEL=${status.model}  in server/.env`);
  } else {
    ok(`Light will use: ${status.model}`);
  }

  // retrieval sanity check (no AI needed)
  const picks = retrieveProducts('قارن بين ساڤاج وبلو دو شانيل', []).slice(0, 3).map(p => p.ar);
  ok(`Product search works (sample: ${picks.join(' | ')})`);

  // 3 — a real answer
  console.log('\n  Asking the model a real question (the first answer can take a while while the model loads)...');
  const t0 = Date.now();
  try {
    const reply = await askAgent('مرحبا، شنو أرخص عطر عندكم؟ جاوب بجملة وحدة.', []);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    ok(`The model answered in ${secs}s:`);
    console.log('\n     ' + reply.split('\n').join('\n     ') + '\n');
    if (secs > 60) {
      console.log('  ⚠️  That was slow. Your computer may be struggling with this model size.');
      info('Try a smaller model:  ollama pull qwen2.5:3b   then set OLLAMA_MODEL=qwen2.5:3b in server/.env');
      info('(Later answers are faster than the first one, because the model stays loaded.)');
    }
    return finish(true);
  } catch (e) {
    bad(`The model failed to answer: ${e.message}`);
    if (/timeout|aborted/i.test(e.message)) {
      info('It took too long. Use a smaller model (qwen2.5:3b or phi3:mini),');
      info('or raise OLLAMA_TIMEOUT_MS in server/.env (in milliseconds).');
    } else if (/memory|RAM/i.test(e.message)) {
      info('Not enough memory for this model. Use a smaller one: ollama pull qwen2.5:3b');
    }
    return finish(false);
  }
})();

function finish(allGood) {
  console.log(allGood
    ? '\n  🎉 Everything works. Start the store with  npm start  and Light will use the AI.\n'
    : '\n  Light cannot answer customers until this is fixed (it has no built-in mode).\n');
  process.exit(allGood ? 0 : 1);
}
