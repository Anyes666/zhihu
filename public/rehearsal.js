const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dims = { demand:'诉求',accuracy:'事实',warmth:'温度',safety:'安全',community:'表达' };
export function mountRehearsal(host, sid, originalText) {
  if (!host) return;
  host.innerHTML = `<section class="parallel panel"><div class="eyebrow">AFTER THE LETTER · 平行试写</div><h2>如果那句话，换一种说法。</h2><p class="muted">这封回信已经寄出。但你可以把同样的线索交给另一个版本的自己。<strong>只改回信，不改已知事实，也不覆盖正式档案。</strong></p><details><summary class="btn ghost">打开另一张信纸 →</summary><form class="parallel-form"><label for="parallel-reply">另一版回信 · 10–2000 字</label><textarea id="parallel-reply" name="reply" minlength="10" maxlength="2000" required>${esc(originalText)}</textarea><div class="parallel-actions"><button type="submit" class="btn">试演这封回信</button><span>规则引擎模拟 · 不调用模型 · 不消耗邮票</span></div></form><p class="parallel-status" role="status" aria-live="polite"></p><div class="parallel-result"></div></details></section>`;
  const form=host.querySelector('form'),status=host.querySelector('.parallel-status'),result=host.querySelector('.parallel-result'); let busy=false;
  form.onsubmit=async event=>{
    event.preventDefault();if(busy)return;busy=true;
    const button=form.querySelector('button');button.disabled=true;status.textContent='保留同一份线索，试演另一种回答…';
    try{
      const res=await fetch(`/api/session/${encodeURIComponent(sid)}/rehearsal`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:form.elements.reply.value})});
      const data=await res.json();if(!res.ok)throw Error(data.error||'试写暂不可用');if(!host.isConnected)return;
      const outcome=(item,label)=>`<article><span class="tag">${label}</span><h3>${esc(item.familyLabel)}</h3><span class="muted">${esc(item.depthLabel)}</span><p class="parallel-quote ${item.quoteRisky?'risky':''}">${item.quoteRisky?'风险措辞 · ':''}「${esc(item.quote)}」</p><details class="parallel-story"><summary>读这条回响</summary>${item.narrative.map(p=>`<p>${esc(p)}</p>`).join('')}</details></article>`;
      status.textContent=data.changed?'同样的线索，回信走向发生了变化。':'回信走向没有改变，看看表达上的差异。';
      result.innerHTML=`<div class="parallel-outcomes">${outcome(data.original,'已寄出的回信')}${outcome(data.alternate,'未寄出的另一版')}</div><h3 class="parallel-delta-title">另一版相对原稿 · 五维变化</h3><div class="parallel-deltas">${Object.entries(dims).map(([key,label])=>`<div data-dimension="${key}" data-delta="${data.delta[key]}" class="${data.delta[key]<0?'negative':data.delta[key]>0?'positive':''}"><span>${label}</span><b>${data.delta[key]>0?'+':''}${data.delta[key]}</b></div>`).join('')}</div><p class="muted">${esc(data.boundary)}</p>`;
    }catch(e){if(host.isConnected)status.textContent=e.message;}
    finally{busy=false;button.disabled=false;}
  };
}
