/* WAR ROOM — Mind (flashcards + maxim bank) */
function viewMind(){
  return header()+
  '<section id="mind-section" class="fade-in">'+
    '<div class="flex gap-2 mb-3">'+
      '<button class="btn flex-1 p-2 text-xs font-bold '+(MIND_MODE==='cards'?'bg-gold/20 border border-gold/50 text-gold':'bg-panel border border-line text-gray-400')+'" data-act="setMindMode" data-args="[&quot;cards&quot;]"><i class="fas fa-layer-group mr-1"></i>DRILL ('+DUE.length+' due)</button>'+
      '<button class="btn flex-1 p-2 text-xs font-bold '+(MIND_MODE==='bank'?'bg-gold/20 border border-gold/50 text-gold':'bg-panel border border-line text-gray-400')+'" data-act="setMindMode" data-args="[&quot;bank&quot;]"><i class="fas fa-book-skull mr-1"></i>MAXIM BANK</button>'+
    '</div>'+
    (MIND_MODE==='cards'?viewCards():viewBank())+
  '</section>';
}

function viewCards(){
  if(!DUE.length) return '<div class="card-lux p-6 text-center"><i class="fas fa-check-double text-3xl text-jade mb-2" style="filter:drop-shadow(0 0 12px rgba(34,197,94,.5))"></i><p class="font-disp font-bold text-lg text-white">ALL PRINCIPLES DRILLED</p><p class="text-[11px] text-gray-500 mt-1">Spaced repetition is scheduling the next ambush. Come back tomorrow — this is how at-your-fingertips is built, rep by rep.</p></div>';
  if(CARD_IDX>=DUE.length) CARD_IDX=0;
  const c=DUE[CARD_IDX];
  const pct=Math.round(((CARD_IDX)/DUE.length)*100);
  let h='<div class="flex items-center gap-2 mb-2"><div class="prog flex-1"><div style="width:'+pct+'%"></div></div><span class="text-[10px] text-gray-500 font-bold">'+(CARD_IDX+1)+'/'+DUE.length+'</span></div>'+
  '<p class="text-[10px] text-gray-500 text-center mb-2 tracking-wider">RECALL THE MASTER READING BEFORE FLIPPING</p>'+
  '<div class="flip-card mb-3" data-act="flipCard">'+
    '<div class="flip-inner '+(CARD_FLIP?'flipped':'')+'" style="min-height:230px">'+
      '<div class="flip-face card-lux gold-glow p-5 flex flex-col justify-center text-center" style="min-height:230px">'+
        '<p class="pill pill-dim mx-auto mb-3">'+esc(c.source)+'</p>'+
        '<p class="font-engraved font-bold text-base leading-snug text-white">“'+esc(c.principle)+'”</p>'+
        '<p class="text-[10px] text-gray-500 mt-4"><i class="fas fa-hand-pointer"></i> tap to reveal readings</p>'+
      '</div>'+
      '<div class="flip-back card p-4 overflow-y-auto" style="min-height:230px">'+
        '<p class="text-[9px] font-bold tracking-widest text-red-400">NAIVE READING (the trap)</p>'+
        '<p class="text-[11px] text-gray-400 mb-2">'+esc(c.naive_reading)+'</p>'+
        '<p class="text-[9px] font-bold tracking-widest text-gold">MASTER READING</p>'+
        '<p class="text-[11px] text-gray-200 mb-2">'+esc(c.master_reading)+'</p>'+
        (c.my_words?'<p class="text-[9px] font-bold tracking-widest text-emerald-400">YOUR WORDS</p><p class="text-[11px] text-emerald-200/80">'+esc(c.my_words)+'</p>':'')+
      '</div>'+
    '</div>'+
  '</div>';
  if(CARD_FLIP) h+='<div class="grid grid-cols-4 gap-1.5">'+
    '<button class="btn p-2.5 bg-red-900/70 border border-red-700 text-red-200 text-[11px] font-bold" data-act="gradeCard" data-args="['+c.maxim_id+',0]">FAIL</button>'+
    '<button class="btn p-2.5 bg-orange-900/70 border border-orange-700 text-orange-200 text-[11px] font-bold" data-act="gradeCard" data-args="['+c.maxim_id+',1]">HARD</button>'+
    '<button class="btn p-2.5 bg-emerald-900/70 border border-emerald-700 text-emerald-200 text-[11px] font-bold" data-act="gradeCard" data-args="['+c.maxim_id+',2]">GOOD</button>'+
    '<button class="btn p-2.5 bg-sky-900/70 border border-sky-700 text-sky-200 text-[11px] font-bold" data-act="gradeCard" data-args="['+c.maxim_id+',3]">EASY</button>'+
  '</div>';
  return h;
}

async function gradeCard(mid,g){
  await api('post','/api/cards/'+mid+'/review',{grade:g,date:todayStr()});
  if(g===0){ FX.fail(); toast('Failed card returns soon. Sun Tzu: know yourself — including what you do not know yet.',true); }
  else FX.tap();
  DUE.splice(CARD_IDX,1); CARD_FLIP=false;
  if(!DUE.length){ FX.confetti({count:70}); FX.toast('DRILL SESSION COMPLETE — all principles rehearsed','gold'); }
  render();
}

function viewBank(){
  const groups={};
  MAXIMS.forEach(m=>{ (groups[m.source]=groups[m.source]||[]).push(m); });
  let h='<div class="card p-3 mb-3">'+
    '<h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2"><i class="fas fa-plus text-gold"></i> ADD YOUR OWN MAXIM (from your reading)</h3>'+
    '<input id="nm-src" placeholder="Source (e.g. Sun Tzu Ch.4)" class="mb-1.5">'+
    '<input id="nm-p" placeholder="The principle / quote" class="mb-1.5">'+
    '<input id="nm-naive" placeholder="Naive reading (the trap)" class="mb-1.5">'+
    '<input id="nm-master" placeholder="Master reading (the extraction)" class="mb-1.5">'+
    '<input id="nm-mine" placeholder="In YOUR words (this is where ownership happens)" class="mb-1.5">'+
    '<button class="btn w-full p-2 bg-gold/20 border border-gold/50 text-gold text-xs font-bold" data-act="addMaxim">DEPOSIT INTO BANK → creates flashcard</button>'+
  '</div>';
  for(const src of Object.keys(groups)){
    const list=groups[src];
    h+='<h3 class="font-disp font-bold text-sm text-gold mt-3 mb-1.5">'+esc(src)+' <span class="text-gray-500 text-[10px]">('+list.length+')</span></h3>';
    h+=list.map(m=>
      '<article class="card p-3 mb-2">'+
        '<p class="text-xs font-semibold leading-snug mb-1.5">"'+esc(m.principle)+'"</p>'+
        '<p class="text-[10px]"><span class="text-red-400 font-bold">✗</span> <span class="text-gray-500">'+esc(m.naive_reading)+'</span></p>'+
        '<p class="text-[10px] mt-0.5"><span class="text-gold font-bold">✓</span> <span class="text-gray-300">'+esc(m.master_reading)+'</span></p>'+
        (m.my_words
          ?'<p class="text-[10px] mt-0.5"><span class="text-emerald-400 font-bold">✍</span> <span class="text-emerald-200/80">'+esc(m.my_words)+'</span></p>'
          :'<button class="text-[10px] text-gray-500 underline mt-1" data-act="ownWords" data-args="['+m.id+']">+ rewrite in my own words</button>')+
      '</article>').join('');
  }
  return h;
}

async function addMaxim(){
  const b={source:$('#nm-src').value,principle:$('#nm-p').value,naive_reading:$('#nm-naive').value,master_reading:$('#nm-master').value,my_words:$('#nm-mine').value};
  if(!b.source||!b.principle){ toast('Source and principle required.',true); return; }
  await api('post','/api/maxims',b);
  MAXIMS=(await axios.get('/api/maxims')).data;
  DUE=(await axios.get('/api/cards/due?date='+todayStr())).data;
  toast('Maxim deposited. Flashcard forged.'); render();
}

async function ownWords(id){
  const w=prompt('Rewrite this principle in YOUR OWN words (own words = ownership):');
  if(!w) return;
  await api('post','/api/maxims/'+id+'/my-words',{my_words:w});
  MAXIMS=(await axios.get('/api/maxims')).data; render();
}

window.gradeCard=gradeCard; window.addMaxim=addMaxim; window.ownWords=ownWords;
registerActions({
  setMindMode: (e, el, mode) => { MIND_MODE = mode; render(); },
  flipCard:    (e, el) => { FX.tap(); CARD_FLIP = !CARD_FLIP; render(); },
  gradeCard:   (e, el, mid, g) => gradeCard(mid, g),
  addMaxim:    () => addMaxim(),
  ownWords:    (e, el, id) => ownWords(id),
});
