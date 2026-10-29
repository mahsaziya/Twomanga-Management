/* Private per-account snapshots and a persistent, explicit file outbox. No passwords are stored. */
(() => {
  const dbReady = new Promise((resolve, reject) => {
    const request = indexedDB.open('two-manga-offline', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('snapshots', {keyPath:'key'});
      db.createObjectStore('outbox', {keyPath:'id'});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  // Handle unsupported/private-storage failures without breaking online use.
  dbReady.catch(()=>{});
  async function store(name, mode, action) {
    const db = await dbReady;
    return new Promise((resolve,reject) => {
      const tx = db.transaction(name,mode), request = action(tx.objectStore(name));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('ذخیره‌سازی روی دستگاه ممکن نیست.'));
    });
  }
  const put = (name,value) => store(name,'readwrite',s=>s.put(value));
  const get = (name,key) => store(name,'readonly',s=>s.get(key));
  const all = name => store(name,'readonly',s=>s.getAll());
  const remove = (name,key) => store(name,'readwrite',s=>s.delete(key));
  let account = null, offline = !navigator.onLine, syncing = false, onSync = ()=>{};
  try { account = JSON.parse(localStorage.getItem('team.last-account') || 'null'); } catch {}
  const banner = document.getElementById('connectionStatus');
  function network(value) {
    offline = !value;
    banner.textContent = value ? 'متصل به سرور' : 'آفلاین · نمایش آخرین اطلاعات ذخیره‌شده؛ تغییرات مدیریتی به اتصال سرور نیاز دارد.';
    banner.classList.toggle('is-offline',!value);
  }
  network(navigator.onLine);
  async function identify(user) {
    account = user;
    try { localStorage.setItem('team.last-account',JSON.stringify(user)); } catch {}
    await refreshOutbox();
  }
  async function clear() {
    account = null;
    try { localStorage.removeItem('team.last-account'); } catch {}
    await Promise.all(['snapshots','outbox'].map(name=>store(name,'readwrite',s=>s.clear()))).catch(()=>{});
  }
  async function http(url, options={}) {
    const response = await fetch(url,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(options.body instanceof Blob?15*60_000:url==='/api/login'?120_000:15_000),...options,headers:{'content-type':options.body instanceof Blob?'application/octet-stream':'application/json',...options.headers}});
    const data = await response.json().catch(()=>({}));
    network(true);
    if (!response.ok) {
      const error = Object.assign(new Error(data.error || 'خطا در ارتباط با سرور'),{status:response.status});
      if(response.status===401 && url!=='/api/login') {
        account=null;
        try {localStorage.removeItem('team.last-account');localStorage.setItem('team.logged-out','1');}catch{}
        if(url!=='/api/me')location.reload();
      }
      throw error;
    }
    return data;
  }
  async function request(url, options={}) {
    if(url.startsWith('/api/upload'))return enqueue(url,options);
    const read = !options.method || options.method==='GET';
    const key = `${account?.id || ''}:${url}`;
    try {
      const data = await http(url,options);
      if(url==='/api/me'||url==='/api/login')await identify(data.user);
      if(read && account) await put('snapshots',{key:`${account.id}:${url}`,data,at:Date.now()}).catch(()=>{});
      return data;
    } catch(error) {
      if(error.status)throw error;
      network(false);
      if(read && account) {
        if(url==='/api/me')return {user:account,offline:true};
        const cached = await get('snapshots',key).catch(()=>null);
        if(cached) {
          banner.textContent += ` آخرین دریافت: ${new Date(cached.at).toLocaleString('fa-IR')}`;
          return cached.data;
        }
      }
      throw new Error(read?'این بخش قبلاً روی این دستگاه ذخیره نشده است. ابتدا به سرور وصل شوید.':'برای ثبت تغییرات مدیریتی باید به سرور وصل باشید. در اجرای محلی، سرور ویندوز را روشن نگه دارید.');
    }
  }
  async function enqueue(url,options) {
    if(!account)throw new Error('ابتدا وارد حساب شوید.');
    const file = options.body;
    if(!(file instanceof Blob)||!file.size)throw new Error('فایل معتبر انتخاب کنید.');
    if(file.size>100*1024*1024)throw new Error('حداکثر حجم هر فایل ۱۰۰ مگابایت است.');
    const assignment = new URL(url,location.origin).searchParams.get('assignmentId');
    const ext = (file.name || '').split('.').pop().toLowerCase();
    if(!['doc','docx','zip'].includes(ext))throw new Error('فقط فایل Word یا ZIP قابل ارسال است.');
    const entries=await all('outbox').catch(()=>[]);
    if(entries.some(e=>e.userId===account.id&&e.assignment===assignment))throw new Error('یک فایل برای این چپتر در صف است. آن را از بخش صف ارسال مدیریت کنید.');
    const key=crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');
    const entry={id:key,userId:account.id,assignment,url,file,name:file.name,createdAt:Date.now(),error:''};
    // Save before the network call: reload/disconnection cannot silently lose a selected file.
    try { await put('outbox',entry); } catch { throw new Error('فضای کافی برای نگهداری فایل روی دستگاه نیست. فضای مرورگر را آزاد کنید و دوباره تلاش کنید.'); }
    await refreshOutbox();
    if(!offline)await sync();
    const remaining = await get('outbox',entry.id);
    return remaining?{ok:true,queued:true}:{ok:true};
  }
  async function sync() {
    if(syncing||!account)return;
    syncing=true;
    let sent=false;
    try {
      const entries=(await all('outbox')).filter(e=>e.userId===account.id).sort((a,b)=>a.createdAt-b.createdAt);
      for(const entry of entries) {
        if(!account||entry.userId!==account.id)break;
        try {
          await http(entry.url,{method:'POST',body:entry.file,headers:{'x-upload-key':entry.id}});
          await remove('outbox',entry.id);sent=true;
        } catch(error) {
          if(!account)break;
          entry.error=error.status?error.message:'ارتباط قطع شد؛ فایل روی این دستگاه نگهداری شده است.';
          await put('outbox',entry);
          if(!error.status){network(false);break;}
          if(error.status===429||error.status>=500)break;
        }
      }
    } finally {
      syncing=false;
      await refreshOutbox();
      if(sent)await onSync();
    }
  }
  async function refreshOutbox() {
    const panel=document.getElementById('outboxPanel'),list=document.getElementById('outboxList');
    panel.classList.toggle('hidden',!account);
    const entries=(await all('outbox').catch(()=>[])).filter(e=>e.userId===account?.id);
    document.getElementById('outboxCount').textContent=new Intl.NumberFormat('fa').format(entries.length);
    list.replaceChildren();
    if(!entries.length){list.textContent='فایلی در صف نیست. فایل‌های صف تا تأیید سرور، تحویل‌شده حساب نمی‌شوند.';return;}
    for(const entry of entries) {
      const row=document.createElement('article');row.className='outbox-item';
      const text=document.createElement('span');text.textContent=`${entry.name} · ${(entry.file.size/1024/1024).toFixed(1)} MB · ${entry.error || 'در انتظار ارسال به سرور'}`;
      const cancel=document.createElement('button');cancel.className='btn small danger';cancel.textContent='حذف از صف';cancel.type='button';cancel.disabled=syncing;
      cancel.onclick=async()=>{if(confirm('این فایل از صف دستگاه حذف شود؟')){await remove('outbox',entry.id);await refreshOutbox();}};
      row.append(text,cancel);list.append(row);
    }
  }
  document.getElementById('retryOutbox').onclick=()=>sync().catch(console.error);
  window.addEventListener('offline',()=>network(false));
  window.addEventListener('online',()=>{network(true);sync().catch(console.error);});
  setInterval(async()=>{
    if(account&&!document.hidden&&navigator.onLine){try{await sync();if(account)await onSync();}catch(error){console.error(error);}}
  },60_000);
  let installPrompt;
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;document.getElementById('installApp').classList.remove('hidden');});
  document.getElementById('installApp').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;document.getElementById('installApp').classList.add('hidden');}};
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(console.error);
  // Mobile tables become labelled cards; keep tables on larger screens.
  const labelTables=()=>document.querySelectorAll('table').forEach(table=>{const headings=[...table.querySelectorAll('thead th')].map(h=>h.textContent);table.querySelectorAll('tbody tr').forEach(row=>[...row.children].forEach((cell,i)=>{if(cell.colSpan===1)cell.dataset.label=headings[i]||'';}));});
  const observer=new MutationObserver(labelTables);observer.observe(document.getElementById('appView'),{childList:true,subtree:true});
  window.TeamOffline={request,identify,clear,sync,refreshOutbox,pendingCount:async()=>(await all('outbox').catch(()=>[])).filter(e=>e.userId===account?.id).length,setOnSync:fn=>{onSync=fn;}};
})();
