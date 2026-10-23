// SPDX-License-Identifier: MPL-2.0
// Opt-in: real public Google course + isolated extension, deterministic local
// translation fixture. Verifies extraction/interaction, not cloud model quality.
const {chromium,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
(async()=>{
 const out=path.resolve('.local-data/preference-refresh/devsite-quiz');fs.mkdirSync(out,{recursive:true});
 const normalize=s=>s.replace(/\s+/g,' ').trim();
 const pairs=[
  ["Both MinDiff and CLP penalize discrepancies in model performance tied to sensitive attributes",'MinDiff 和 CLP 都会惩罚与敏感属性相关的模型表现差异。'],
  ["MinDiff penalizes differences in the overall distribution of predictions for different slices of data, whereas CLP penalizes discrepancies in predictions for individual pairs of examples.",'MinDiff 惩罚不同数据切片的整体预测分布差异，而 CLP 惩罚成对样本之间的预测差异。'],
  ["Adding more examples to the training dataset will always help counteract bias in a model's predictions.",'向训练数据集添加更多样本，总是有助于抵消模型预测中的偏差。'],
  ["If you are mitigating bias by adding more training data, you shouldn't also apply MinDiff or CLP during training.",'如果通过增加训练数据来减轻偏差，就不应在训练中同时应用 MinDiff 或 CLP。']
 ];const dictionary=new Map(pairs.map(([a,b])=>[normalize(a),b]));const requested=[];
 const server=http.createServer((req,res)=>{let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{const body=JSON.parse(raw),input=JSON.parse(body.messages.find(row=>row.role==='user').content);requested.push(...input.segments.map(s=>normalize(s.text)));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({translations:input.segments.map(s=>({id:s.id,text:dictionary.get(normalize(s.text))||'译文：'+s.text}))})},finish_reason:'stop'}]}));});});
 await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
 let context;
 try{
  const extension=path.resolve('build/TWP_AI_0.1.0_Chromium_MV3');context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(out,'profile-')),{channel:'chromium',headless:true,viewport:{width:1500,height:1300},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set('targetLanguages',['zh-CN','en','es']);twpConfig.set('targetLanguage','zh-CN');twpConfig.set('pageTranslatorService','openai');});
  const settings=await context.newPage();await settings.goto('chrome-extension://'+new URL(worker.url()).host+'/options/ai.html');await settings.locator('#profile-name').fill('Quiz extraction fixture');await settings.locator('#base-url').fill('http://127.0.0.1:'+server.address().port+'/v1');await settings.locator('#model').fill('deterministic-quiz-fixture');await settings.locator('#profile-form button[type=submit]').click();await expect(settings.locator('#profile-status')).toContainText('服务已保存');
  const page=await context.newPage();await page.goto('https://developers.google.com/machine-learning/crash-course/fairness/mitigating-bias',{waitUntil:'domcontentloaded',timeout:30000});
  const quiz=page.locator('devsite-multiple-choice[rendered]');await expect(quiz).toHaveCount(1,{timeout:20000});await quiz.scrollIntoViewIfNeeded();
  await quiz.locator('[answer-id="1"]').evaluate(el=>{window.originalQuizAnswer=el;window.quizClickCount=0;el.addEventListener('click',()=>window.quizClickCount++);});
  const floating=page.locator('#twp-floating');await floating.locator('#toggle').hover();await floating.locator('#settings').click();await floating.locator('#target').selectOption('zh-CN');await floating.locator('#translate').click();await floating.locator('#close').click();
  const translations=quiz.locator('.devsite-multiple-choice-option > [data-twp-bilingual]');await expect(translations).toHaveCount(4,{timeout:20000});
  for(const [english,chinese]of pairs){expect(requested).toContain(normalize(english));await expect(quiz.getByText(chinese,{exact:true})).toHaveCount(1);}
  const correct=quiz.locator('[answer-id="1"]');await correct.locator('.devsite-multiple-choice-option > [data-twp-bilingual]').click();
  await expect(correct.locator('.devsite-multiple-choice-explanation')).toBeVisible();await expect(correct.locator('.devsite-multiple-choice-explanation [data-twp-bilingual]').filter({hasText:'Both techniques aim to mitigate bias'})).toHaveCount(1,{timeout:15000});
  const feedback=await correct.locator('.devsite-multiple-choice-explanation [data-twp-bilingual]').allTextContents();expect(new Set(feedback).size).toBe(feedback.length);
  expect(await correct.evaluate(el=>el===window.originalQuizAnswer&&window.quizClickCount===1)).toBe(true);
  await quiz.screenshot({path:path.join(out,'translated-answers.png')});
  await floating.locator('#toggle').click();await expect(quiz.locator('[data-twp-bilingual]')).toHaveCount(0);await expect(correct.locator('.devsite-multiple-choice-option')).toHaveText(pairs[0][0]);
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({realPublicPage:true,translationFixture:true,translatedAnswers:4,revealedExplanation:true,answerNodePreserved:true,clickCount:1,restore:true},null,2));
  console.log('Actual Google course passed: four translated answers, native answer click, revealed feedback translation and restore; deterministic translation fixture.');
 }finally{await context?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
