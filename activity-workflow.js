/* V2.1A-01 integration. Loaded after app.js; old data remains available in History. */
var currentActivity=null,currentActivityId=null,activityWorkspaceTab='overview',activityWorkspaceShowSupport=false;
(function() {
  'use strict';
  const C=DoiWorkflowCore, state=new Map(), busy=new Set();
  const oldDetail=renderActivityDetail,oldQuick=openQuickActivityModal,oldSaveActivity=saveActivity;
  const oldEditActivity=editActivity,oldFormRow=activityFormRow;
  const statusNames={pending:'Chưa chạy',running:'Đang xử lý',paused:'Đang tạm dừng',completed:'Đã tạo đủ bản nháp'};
  let quickRequest=null,quickCreating=false, dbPromise=null, refreshTicket=0;
  function friendly(e) {
    const msg=e?.message||String(e);
    return /activity_workflow|doi_workflow|schema cache|facts_revision|duration_minutes/.test(msg)
      ? 'Chưa cài phần lưu tiến trình. Chạy file SQL V2.1A-01 trước khi dùng tính năng này.' : msg;
  }
  async function rpc(name,args) { const r=await sb.rpc(name,args);if(r.error)throw new Error(friendly(r.error));return r.data; }
  async function hash(value) {
    const data=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(C.stable(value)));
    return [...new Uint8Array(data)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function docId(job,key,input,deps) {
    const h=await hash({job,key,input,deps});return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
  }
  function keysFor(keys) {
    const set=new Set(C.ordered(keys));
    if(set.has('mc')) {set.add('script');set.add('plan');} if(set.has('script'))set.add('plan');
    return C.ordered([...set]);
  }
  // Received AI output survives reload on this device until its database checkpoint succeeds.
  function database() {
    if(!dbPromise) dbPromise=new Promise((resolve,reject)=>{
      const req=indexedDB.open('doi_workflow_received_v21',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('received');
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(new Error('Trình duyệt chưa lưu được bản nháp phục hồi. Kiểm tra dung lượng và chế độ riêng tư.'));
    });return dbPromise;
  }
  async function bufferAction(mode,id,value) {
    const db=await database(),owner=currentUser.id;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('received',mode==='get'?'readonly':'readwrite'),store=tx.objectStore('received');
      const req=mode==='get'?store.get(owner+':'+id):mode==='put'?store.put(value,owner+':'+id):store.delete(owner+':'+id);
      tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(new Error('Không lưu được bản nháp phục hồi trên thiết bị.'));tx.onabort=()=>reject(new Error('Lưu bản nháp phục hồi bị gián đoạn.'));
    });
  }
  const buffer={get:id=>bufferAction('get',id),put:(id,v)=>bufferAction('put',id,v),remove:id=>bufferAction('delete',id)};
  async function loadBundle(activityId,jobId=null) {
    if(!sb||demo)throw new Error('Cần đăng nhập để lưu tiến trình.');
    const queries=[
      sb.from('team_activities').select('*').eq('id',activityId).eq('created_by',currentUser.id).single(),
      sb.from('activity_workflow_jobs').select('*').eq('activity_id',activityId).order('created_at',{ascending:false}),
      sb.from('activity_workflow_documents').select('*').eq('activity_id',activityId).order('created_at',{ascending:false}),
      sb.from('activity_source_files').select('id,file_name,analysis_json,drive_web_view_link,created_at').eq('activity_id',activityId).order('created_at',{ascending:false}).order('id'),
      sb.from('activity_results').select('*').eq('activity_id',activityId).maybeSingle(),
      sb.from('activity_evidence').select('id,evidence_type,title,evidence_date,external_url,description').eq('activity_id',activityId).order('id'),
      sb.from('lien_doi_profile').select('*').eq('user_id',currentUser.id).maybeSingle()
    ];
    const results=await Promise.all(queries);for(const r of results)if(r.error)throw new Error(friendly(r.error));
    const [a,j,d,s,r,e,p]=results.map(x=>x.data);
    const context={profile:p||{},sources:s||[],result:r||null,evidence:e||[]};
    // Updating actual results only invalidates reports, not preparation documents.
    const base=await hash({facts:{...C.facts(a),status:null},profile:context.profile,sources:context.sources});
    const report=await hash({base,status:a.status,result:context.result,evidence:context.evidence});
    const bundle={activity:a,jobs:j||[],documents:d||[],context,hashes:{base,report},job:(j||[]).find(x=>x.id===jobId)};
    if(jobId&&!bundle.job)throw new Error('Không tìm thấy tiến trình đã lưu.');
    state.set(activityId,bundle);
    const index=activityCache.findIndex(x=>x.id===activityId);if(index>=0)activityCache[index]=a;
    if(currentActivityId===activityId)currentActivity=a;
    return bundle;
  }
  function progress(activityId,key,phase) {
    const text={generating:'Đang tạo',saving:'Đang lưu lại bản đã nhận',saved:'Đã lưu bản nháp',reused:'Giữ tài liệu đã có'};
    const message=`${text[phase]}: ${activityAITasks[key]?.[0]||key}`;
    const node=document.getElementById('workflowLiveStatus');if(node&&currentActivityId===activityId)node.textContent=message;
    const q=document.getElementById('quickActivityProgress');if(q&&!q.closest('.hidden'))q.textContent=message;
  }
  async function run(jobId,activityId,customGenerator=null) {
    if(busy.has(activityId))return;
    busy.add(activityId);renderWorkflow();let succeeded=false;
    const io={uuid:()=>crypto.randomUUID(),title:key=>activityAITasks[key]?.[0]||key,
      load:()=>loadBundle(activityId,jobId),
      documentId:docId,buffer,
      generate:async(key,prompt,b,requestId)=>{
        if(customGenerator)return customGenerator(key,prompt,b,requestId);
        if(b.job.generation_route==='source_plan'&&key==='plan') {
          const source=b.context.sources[0];if(!source)throw new Error('Chưa có nguồn chỉ đạo đã phân tích.');
          const r=await sb.functions.invoke(SOURCE_AI_FUNCTION_NAME,{body:{mode:'generate_plan',request_id:requestId,prompt,
            profile:b.context.profile,activity:{...b.activity,issuer_type:resolvedIssuer(b.activity),issuer_label:issuerLabel(resolvedIssuer(b.activity)),source_link:source.drive_web_view_link||''},analysis:source.analysis_json||{}}});
          if(r.error)throw r.error;if(r.data?.error)throw new Error(r.data.error);
          return cleanExportText(r.data?.text||r.data?.content||'');
        }
        const r=await sb.functions.invoke(AI_FUNCTION_NAME,{body:{module:'assistant',task_type:`activity_${key}`,
          task_name:activityAITasks[key]?.[0]||key,profile:b.context.profile,audience:b.activity.audience||'',
          activity_id:activityId,request_id:requestId,prompt}});
        if(r.error)throw new Error(r.error.message);if(r.data?.error)throw new Error(r.data.error);
        return cleanExportText(r.data?.text||r.data?.content||r.data?.result||r.data?.output||'');
      },
      save:(id,token,v)=>rpc('doi_workflow_save',{p_job_id:id,p_token:token,p_document_id:v.documentId,
        p_key:v.key,p_title:activityAITasks[v.key]?.[0]||v.key,p_prompt:v.prompt,p_result:v.result,
        p_dependencies:v.dependencies,p_input_hash:v.inputHash}),
      release:(id,token,done,error)=>rpc('doi_workflow_release',{p_job_id:id,p_token:token,p_completed:done,p_error:error}),
      releaseWarning:()=>toast('Đã giữ tiến trình. Nếu còn báo đang xử lý, chờ khóa hết hạn rồi tiếp tục.','bad')};
    io.claim=(b,token)=>{return rpc('doi_workflow_claim',{p_job_id:jobId,p_token:token,
      p_revision:b.activity.facts_revision,p_facts:C.facts(b.activity),p_context:{...b.context,report_hash:b.hashes.report},p_input_hash:b.hashes.base});};
    try {
      await DoiWorkflowEngine.create(io).run(jobId,(key,phase)=>progress(activityId,key,phase));
      succeeded=true;
      if(quickRequest?.id===jobId) {localStorage.removeItem(requestStorageKey());quickRequest=null;}
      toast('Đã tạo đủ bản nháp. Kiểm tra nội dung trước khi duyệt.');
    } catch(e) {
      const msg=friendly(e);toast('Đã tạm dừng. Tài liệu đã lưu được giữ nguyên.','bad');
      const n=document.getElementById('quickActivityProgress');if(n)n.textContent=msg+' Bấm Tiếp tục để chạy phần còn thiếu.';
    } finally {
      busy.delete(activityId);
      try {await loadBundle(activityId);await refreshWorkspaceHistory();renderWorkflow();}catch(e){showWorkflowError(e);}
    }
    return succeeded;
  }
  function requestStorageKey(){return 'doi_workflow_pending_v21:'+currentUser.id;}
  async function start(keys,activityId=null,activity=null,requestId=null,forceKeys=[],route='activity') {
    const id=requestId||crypto.randomUUID();
    const job=await rpc('doi_workflow_start',{p_job_id:id,p_keys:keysFor(keys),p_activity_id:activityId,p_activity:activity||{},p_force_keys:forceKeys,p_route:route});
    await loadBundle(job.activity_id);return job;
  }
  function showWorkflowError(e) {
    const host=document.getElementById('activityWorkspaceContent');
    if(host)host.innerHTML=`<div class="workflow-warning" role="alert">${esc(friendly(e))}<button class="btn secondary" onclick="refreshActivityWorkflow()">Thử tải lại</button></div>`;
  }
  window.refreshActivityWorkflow=async()=>{
    const id=currentActivityId,ticket=++refreshTicket;if(!id)return;
    try{await loadBundle(id);if(id===currentActivityId&&ticket===refreshTicket)renderWorkflow();}catch(e){if(id===currentActivityId&&ticket===refreshTicket)showWorkflowError(e);}
  };
  renderActivityDetail=function(x) {
    oldDetail(x);currentActivity=x||null;currentActivityId=x?.id||null;if(!x)return;
    activityWorkspaceTab='overview';
    const detail=document.getElementById('activityDetail');
    const legacy=detail.querySelector('.ai-center');if(legacy)legacy.classList.add('hidden');
    const workspace=document.createElement('section');workspace.className='activity-workspace workflow-v21';
    workspace.innerHTML=`<div class="workflow-head"><div><small>HỒ SƠ HOẠT ĐỘNG</small><h4>Một bộ dữ kiện · Tài liệu thống nhất</h4></div><button class="btn small secondary" onclick="refreshActivityWorkflow()">Làm mới</button></div>
      <div class="workflow-tabs" role="tablist">${[['overview','Tổng quan'],['documents','Tài liệu'],['evidence','Minh chứng & Kết quả'],['history','Lịch sử']].map(([k,t])=>`<button role="tab" id="workflowTab_${k}" aria-controls="workflowPanel_${k}" onclick="switchWorkflowTab('${k}')">${t}</button>`).join('')}</div>
      <div id="workflowLiveStatus" class="muted" role="status" aria-live="polite"></div><div id="activityWorkspaceContent">Đang tải dữ kiện và tiến trình…</div><div id="workflowEvidenceHost" role="tabpanel" aria-labelledby="workflowTab_evidence" class="hidden"></div>`;
    if(legacy)legacy.before(workspace);else detail.appendChild(workspace);
    const evidenceHost=document.getElementById('workflowEvidenceHost');
    detail.querySelectorAll('.activity-record-section').forEach(n=>evidenceHost.appendChild(n));
    window.refreshActivityWorkflow();
  };
  window.switchWorkflowTab=tab=>{activityWorkspaceTab=tab;renderWorkflow();};
  function documentState(d,b,all) {return !d?'Chưa tạo':C.stale(d,b.hashes,all)?'Cần cập nhật':d.review_status==='approved'?'Đã duyệt':'Bản nháp chưa duyệt';}
  function renderWorkflow() {
    const host=document.getElementById('activityWorkspaceContent'),b=state.get(currentActivityId);if(!host||!b)return;
    const available=C.latest(b.documents),active=busy.has(currentActivityId),isEvidence=activityWorkspaceTab==='evidence';
    host.classList.toggle('hidden',isEvidence);document.getElementById('workflowEvidenceHost')?.classList.toggle('hidden',!isEvidence);
    document.querySelectorAll('.workflow-tabs button').forEach(n=>{const selected=n.id==='workflowTab_'+activityWorkspaceTab;n.classList.toggle('active',selected);n.setAttribute('aria-selected',String(selected));});
    host.setAttribute('role','tabpanel');host.setAttribute('aria-labelledby','workflowTab_'+activityWorkspaceTab);
    if(isEvidence)return;
    if(activityWorkspaceTab==='overview') {
      const missing=C.missing(C.facts(b.activity)),labels={start_date:'Ngày tổ chức',location:'Địa điểm',audience:'Đối tượng'};
      const current=b.jobs.find(j=>j.state!=='completed');
      const approved=Object.values(available).filter(d=>d.review_status==='approved'&&!C.stale(d,b.hashes,available)).length;
      host.innerHTML=`<div class="workflow-summary"><b>Dữ kiện chung · phiên bản ${b.activity.facts_revision}</b><p>Tất cả tài liệu lấy dữ kiện từ hồ sơ hoạt động. Sửa một lần tại đây.</p>
        <div class="workflow-facts"><span>Ngày: ${esc(activityDateText(b.activity))}</span><span>Địa điểm: ${esc(b.activity.location||'CẦN XÁC NHẬN')}</span><span>Đối tượng: ${esc(b.activity.audience||'CẦN XÁC NHẬN')}</span><span>Thời lượng: ${b.activity.duration_minutes?esc(b.activity.duration_minutes)+' phút':'CẦN XÁC NHẬN'}</span></div>
        ${missing.length?`<div class="workflow-warning">Chưa xác nhận: ${missing.map(k=>labels[k]).join(', ')}. AI sẽ đánh dấu phần còn thiếu.</div>`:''}
        <p>${approved} tài liệu đã duyệt và còn khớp dữ kiện hiện tại.</p><button class="btn secondary" onclick="editActivity('${b.activity.id}')">Chỉnh dữ kiện chung</button>
        <button class="btn primary" ${active?'disabled':''} onclick="createWorkflowSet()">Chuẩn bị bộ Kế hoạch · Kịch bản · Lời dẫn</button></div>
        ${current?jobHTML(current,b,active):'<div class="muted">Tiến trình được lưu tự động. Tải lại trang vẫn có thể tiếp tục.</div>'}`;
    } else if(activityWorkspaceTab==='documents') {
      host.innerHTML=C.ORDER.map(key=>{
        const d=available[key],stale=d&&C.stale(d,b.hashes,available),title=activityAITasks[key]?.[0]||key;
        return `<article class="workflow-doc"><div><b>${esc(title)}</b><small class="${stale?'workflow-warning-text':''}">${documentState(d,b,available)}</small></div><div class="action-row">
          <button class="btn small ${d?'secondary':'primary'}" ${active?'disabled':''} onclick="createWorkflowDocument('${key}')">${d?'Tạo bản mới':'Tạo bằng AI'}</button>
          ${d?`<button class="btn small secondary" onclick="openWorkflowDocument('${d.id}')">Mở / Duyệt</button><button class="btn small secondary" onclick="exportWorkflowDocument('${d.id}')">Xuất Word</button>`:''}</div></article>`;
      }).join('')+'<p class="muted">Tài liệu cũ chưa có dấu vết dữ kiện được giữ trong Lịch sử; không tự đánh dấu đã duyệt.</p>';
    } else {
      host.innerHTML=`<b>Tiến trình và các phiên bản</b>${b.jobs.map(j=>jobHTML(j,b,active)).join('')}
        <div class="workflow-versions">${b.documents.map(d=>`<div class="workflow-version"><span>${esc(activityAITasks[d.doc_key]?.[0]||d.doc_key)} · ${esc(fmtDate(d.created_at))} · ${esc(documentState(d,b,available))}</span><button class="btn small secondary" onclick="openWorkflowDocument('${d.id}')">Xem bản này</button></div>`).join('')}</div>
        <button class="btn secondary" onclick="showLegacyWorkflowHistory()">Xem lịch sử tài liệu cũ</button><div id="workflowLegacyHistory"></div>`;
    }
  }
  function jobHTML(j,b,active) {
    const latest=C.latest(b.documents),count=j.requested_keys.filter(k=>C.reusable(latest[k],b.hashes,latest)).length;
    return `<div class="workflow-job"><b>${esc(statusNames[j.state]||j.state)} · ${count}/${j.requested_keys.length} tài liệu khớp dữ kiện</b>
      ${j.last_error?`<p class="workflow-warning-text">${esc(j.last_error)}</p>`:''}<small>${esc(fmtDate(j.updated_at))}</small>
      ${j.state==='running'&&j.lease_until?`<small>Nếu phiên trước bị ngắt, có thể tiếp tục sau ${esc(fmtDate(j.lease_until))}.</small>`:''}
      ${j.state!=='completed'||count<j.requested_keys.length?`<button class="btn small primary" ${active?'disabled':''} onclick="resumeActivityWorkflow('${j.id}')">Tiếp tục phần còn thiếu</button>`:''}</div>`;
  }
  renderActivityWorkspace=renderWorkflow;
  window.resumeActivityWorkflow=async id=>{const b=state.get(currentActivityId),j=b?.jobs.find(x=>x.id===id);if(j)await run(id,j.activity_id);};
  window.createWorkflowSet=async()=>{await createDocumentJob(['plan','script','mc']);};
  window.createWorkflowDocument=async key=>{await createDocumentJob([key],currentActivityId,[key]);};
  async function createDocumentJob(keys,activityId=currentActivityId,forceKeys=[]) {
    if(!activityId||busy.has(activityId))return;
    busy.add(activityId);renderWorkflow();
    try{
      const b=await loadBundle(activityId),expanded=keysFor(keys);
      const unfinished=b.jobs.find(j=>j.state!=='completed'&&C.stable(C.ordered(j.requested_keys))===C.stable(expanded));
      const j=unfinished||await start(expanded,activityId,null,null,forceKeys);
      busy.delete(activityId);await run(j.id,activityId);
    }catch(e){busy.delete(activityId);toast(friendly(e),'bad');renderWorkflow();}
  }
  generateActivityAI=async(id,key)=>createDocumentJob([key],id);
  generateQuickActivityDocument=async(id,key)=>createDocumentJob([key],id);
  createIndependentActivityDocument=async key=>createDocumentJob([key]);
  // Source ingestion keeps its existing Gemini endpoint, but uses the same durable checkpoint.
  generatePlanFromSource=async function(activity,analysis,sourceLink) {
    const b=await loadBundle(activity.id);
    const unfinished=b.jobs.find(j=>j.state!=='completed'&&C.stable(j.requested_keys)===C.stable(['plan']));
    const j=unfinished||await start(['plan'],activity.id,null,null,[],'source_plan');
    const ok=await run(j.id,activity.id,async(key,prompt,current,requestId)=>{
      const r=await sb.functions.invoke(SOURCE_AI_FUNCTION_NAME,{body:{mode:'generate_plan',request_id:requestId,prompt,
        profile:current.context.profile,activity:{...current.activity,issuer_type:resolvedIssuer(current.activity),
          issuer_label:issuerLabel(resolvedIssuer(current.activity)),source_link:sourceLink||''},analysis}});
      if(r.error)throw r.error;if(r.data?.error)throw new Error(r.data.error);
      return cleanExportText(r.data?.text||r.data?.content||'');
    });
    if(!ok)throw new Error('Kế hoạch chưa hoàn tất. Mở hồ sơ hoạt động và bấm Tiếp tục phần còn thiếu.');
    return C.latest(state.get(activity.id).documents).plan?.result||'';
  };
  openQuickActivityModal=function() {
    oldQuick();
    if(!document.getElementById('qaTime')) {
      const grid=document.getElementById('qaDate').closest('.quick-grid');
      grid.insertAdjacentHTML('beforeend',`<label class="quick-field"><span>Giờ bắt đầu (không bắt buộc)</span><input id="qaTime" type="time"></label><label class="quick-field"><span>Thời lượng (phút)</span><input id="qaDuration" type="number" min="1" max="1440" placeholder="Chưa xác nhận"></label>`);
      const note=document.querySelector('#quickActivityModal .quick-ai-note');if(note)note.innerHTML='<b>Nhập dữ kiện một lần</b><span>AI đề xuất mục tiêu/nội dung trong bản nháp; thông tin còn thiếu được đánh dấu cần xác nhận.</span>';
      ['qaLocation','qaAudience'].forEach(id=>{const opt=document.getElementById(id).options[0];opt.value='';opt.textContent='Chưa xác nhận';});
      document.getElementById('quickActivityCreateBtn').insertAdjacentHTML('afterend','<button id="quickActivityResumeBtn" class="btn secondary hidden" onclick="resumeQuickActivityWorkflow()">Tiếp tục tiến trình đã lưu</button>');
    }
    document.getElementById('qaTime').value='';document.getElementById('qaDuration').value='';
    const today=new Date();today.setMinutes(today.getMinutes()-today.getTimezoneOffset());document.getElementById('qaDate').value=today.toISOString().slice(0,10);
    document.getElementById('qaLocation').value='';document.getElementById('qaAudience').value='';
    try{quickRequest=JSON.parse(localStorage.getItem(requestStorageKey())||'null');}catch{quickRequest=null;}
    document.getElementById('quickActivityResumeBtn').classList.toggle('hidden',!quickRequest);
    document.getElementById('quickActivityCreateBtn').disabled=!!quickRequest;
    if(quickRequest){const p=document.getElementById('quickActivityProgress');p.classList.remove('hidden');p.textContent='Có yêu cầu chưa hoàn tất. Tiếp tục yêu cầu này để tránh tạo hoạt động trùng.';}
  };
  async function executeQuick(request) {
    const j=await start(request.keys,null,request.activity,request.id);
    quickRequest.activityId=j.activity_id;localStorage.setItem(requestStorageKey(),JSON.stringify(quickRequest));
    const b=await loadBundle(j.activity_id);activityCache=activityCache.filter(x=>x.id!==j.activity_id);activityCache.unshift(b.activity);
    currentActivity=b.activity;currentActivityId=j.activity_id;
    await run(j.id,j.activity_id);
    closeQuickActivityModal();
    if(document.getElementById('activityList')){await loadActivities();openActivity(j.activity_id);}
    else {await go('activities');openActivity(j.activity_id);}
  }
  createQuickActivityAndDocuments=async function() {
    if(quickCreating)return;if(demo||!sb)return alert('Cần đăng nhập để lưu tiến trình.');
    if(quickRequest)return window.resumeQuickActivityWorkflow();
    const name=document.getElementById('qaName').value.trim(),date=document.getElementById('qaDate').value;
    const durationText=document.getElementById('qaDuration').value.trim();
    const keys=keysFor(selectedQuickDocs()),duration=durationText===''?null:Number(durationText);
    if(!name||!date||!keys.length)return alert('Nhập tên, ngày tổ chức và chọn ít nhất một tài liệu.');
    if(duration!==null&&(!Number.isInteger(duration)||duration<1||duration>1440))return alert('Thời lượng từ 1 đến 1440 phút.');
    quickCreating=true;
    const btn=document.getElementById('quickActivityCreateBtn');btn.disabled=true;
    const p=document.getElementById('quickActivityProgress');p.classList.remove('hidden');p.textContent='Đang lưu hoạt động và tiến trình…';
    try {
      await loadProfileCache();
      quickRequest={id:crypto.randomUUID(),keys,activity:{school_year:cachedProfile?.school_year||'2026-2027',activity_name:name,
        activity_type:'Khác',issuer_type:document.getElementById('qaIssuer').value,start_date:date,end_date:date,
        start_time:document.getElementById('qaTime').value||null,duration_minutes:duration,
        location:document.getElementById('qaLocation').value||null,audience:document.getElementById('qaAudience').value||null,
        person_in_charge:cachedProfile?.tong_phu_trach_name||'',estimated_budget:null,notes:'Tạo nhanh · dữ kiện dùng chung'}};
      localStorage.setItem(requestStorageKey(),JSON.stringify(quickRequest));
      await executeQuick(quickRequest);
    }catch(e){p.textContent=friendly(e)+' Yêu cầu đã được giữ để tiếp tục.';document.getElementById('quickActivityResumeBtn').classList.remove('hidden');}
    finally{quickCreating=false;btn.disabled=!!quickRequest;}
  };
  window.resumeQuickActivityWorkflow=async()=>{
    if(!quickRequest||quickCreating)return;quickCreating=true;
    try{await executeQuick(quickRequest);}catch(e){document.getElementById('quickActivityProgress').textContent=friendly(e);}
    finally{quickCreating=false;}
  };
  activityFormRow=function(){const row=oldFormRow();row.duration_minutes=Number(document.getElementById('acDuration')?.value)||null;row.estimated_budget_confirmed=document.getElementById('acBudget').value.trim()!=='';return row;};
  editActivity=function(id){oldEditActivity(id);const a=activityCache.find(x=>x.id===id),time=document.getElementById('acTime');
    if(time&&!document.getElementById('acDuration'))time.closest('div').insertAdjacentHTML('afterend','<div><label>Thời lượng (phút)</label><input id="acDuration" type="number" min="1" max="1440"></div>');
    if(document.getElementById('acDuration'))document.getElementById('acDuration').value=a?.duration_minutes||'';
    if(a?.estimated_budget_confirmed===false)document.getElementById('acBudget').value='';
  };
  saveActivity=async function(){
    const raw=document.getElementById('acDuration')?.value.trim()||'';
    if(raw&&(!Number.isInteger(Number(raw))||Number(raw)<1||Number(raw)>1440))return alert('Thời lượng từ 1 đến 1440 phút.');
    const id=editingActivityId;await oldSaveActivity();if(id&&document.getElementById('activityList'))openActivity(id);
  };
  window.showLegacyWorkflowHistory=async()=>{
    const r=await sb.from('ai_history').select('id,title,result,created_at').eq('activity_id',currentActivityId).order('created_at',{ascending:false});
    if(r.error)return toast(r.error.message,'bad');const host=document.getElementById('workflowLegacyHistory');if(host)host.innerHTML=(r.data||[]).map(x=>`<details class="workflow-job"><summary>${esc(x.title)} · ${esc(fmtDate(x.created_at))}</summary><pre class="workflow-text">${esc(x.result||'')}</pre></details>`).join('');
  };
  // Studio receives exactly the same facts and current references as built-in generation.
  const oldStudioSave=saveChatGPTStudioResult;
  let studioSnapshot=null,studioSaving=false;
  const studioKey=kind=>({facebook:'fanpage',quiz:'quiz',script:'script',mc:'mc',radio:'radio'})[kind]||null;
  buildCommunicationPrompt=async function() {
    const id=communicationActivityId,status=document.getElementById('commStatus');if(!id)return;
    status.textContent='Đang lấy dữ kiện chung và tài liệu còn khớp nguồn…';
    try {
      const b=await loadBundle(id),kind=document.getElementById('commType').value,key=studioKey(kind)||kind;
      const all=C.latest(b.documents),refs=Object.fromEntries(Object.entries(all).filter(([,d])=>C.reusable(d,b.hashes,all)));
      const visual=['poster','infographic','both'].includes(kind);
      const notes=document.getElementById('commNotes').value.trim();
      communicationPrompt=C.prompt(key,communicationTypes[kind]||kind,C.facts(b.activity),b.context,refs)+
        (kind==='radio'?'\nPhát thanh khoảng 5 phút; có mở đầu, nội dung, thông điệp giáo dục và lời kết.\n':'')+
        (visual?'\nThiết kế hình ảnh theo loại đã chọn. Dùng tiếng Việt có dấu, kiểm tra chính tả, không tự vẽ lại logo; yêu cầu đính kèm logo gốc nếu chưa được cung cấp. Không bịa QR, thời gian hoặc thể lệ. Poster + Infographic phải là hai ảnh riêng.\n':'')+
        (notes?'\nYÊU CẦU BỔ SUNG CỦA NGƯỜI DÙNG:\n'+notes:'');
      document.getElementById('commPrompt').value=communicationPrompt;
      studioSnapshot={activityId:id,kind,hash:C.inputHash(key,b.hashes),dependencies:C.dependencies(key,refs),prompt:communicationPrompt};
      status.textContent='Đã tổng hợp dữ kiện hiện tại. Sao chép để sử dụng trong ChatGPT.';
    }catch(e){status.textContent=friendly(e);}
  };
  saveChatGPTStudioResult=async function() {
    if(studioSaving)return;
    const id=communicationActivityId,kind=document.getElementById('commType').value,key=studioKey(kind),status=document.getElementById('chatgptResultStatus');
    if(!key)return oldStudioSave();
    const result=cleanExportText(document.getElementById('chatgptResult').value.trim());if(!result)return alert('Dán kết quả ChatGPT trước khi lưu.');
    let j=null,token=null;studioSaving=true;
    try {
      const b=await loadBundle(id),all=C.latest(b.documents),refs=Object.fromEntries(Object.entries(all).filter(([,d])=>C.reusable(d,b.hashes,all)));
      if(!studioSnapshot||studioSnapshot.activityId!==id||studioSnapshot.kind!==kind)throw new Error('Tạo prompt từ dữ kiện chung trước khi lưu sản phẩm này.');
      const deps=C.dependencies(key,refs);
      const input=C.inputHash(key,b.hashes);
      if(studioSnapshot.hash!==input||C.stable(studioSnapshot.dependencies)!==C.stable(deps))throw new Error('Dữ kiện hoặc tài liệu tham chiếu đã thay đổi từ lúc tạo prompt. Tạo prompt mới và cập nhật sản phẩm trước khi lưu.');
      // Stable ID also prevents duplicate imports after a lost response or double click.
      const h=await hash({id,kind,result,prompt:studioSnapshot.prompt,input,deps});
      const requestId=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
      j=await rpc('doi_workflow_start',{p_job_id:requestId,p_keys:[key],p_activity_id:id,p_activity:{},p_force_keys:[]});token=crypto.randomUUID();
      await rpc('doi_workflow_claim',{p_job_id:j.id,p_token:token,p_revision:b.activity.facts_revision,p_facts:C.facts(b.activity),p_context:{...b.context,report_hash:b.hashes.report},p_input_hash:b.hashes.base});
      const documentId=await docId(j.id,key,input,deps);
      await rpc('doi_workflow_save',{p_job_id:j.id,p_token:token,p_document_id:documentId,p_key:key,p_title:activityAITasks[key][0],p_prompt:studioSnapshot.prompt,p_result:result,p_dependencies:deps,p_input_hash:input});
      await rpc('doi_workflow_release',{p_job_id:j.id,p_token:token,p_completed:true,p_error:null});token=null;
      status.textContent='Đã lưu bản nháp vào Tài liệu của hoạt động. Kiểm tra và duyệt trước khi sử dụng.';
      await window.refreshActivityWorkflow();toast('Đã lưu sản phẩm ChatGPT theo dữ kiện chung.');
    }catch(e){status.textContent=friendly(e);if(j&&token)await rpc('doi_workflow_release',{p_job_id:j.id,p_token:token,p_completed:false,p_error:friendly(e)}).catch(()=>{});}
    finally{studioSaving=false;}
  };
  window.openWorkflowDocument=async id=>{
    const b=state.get(currentActivityId),d=b?.documents.find(x=>x.id===id);if(!d)return;
    let modal=document.getElementById('workflowReviewModal');if(!modal){modal=document.createElement('div');modal.id='workflowReviewModal';modal.className='word-export-modal';document.body.appendChild(modal);}
    const all=C.latest(b.documents),outdated=C.stale(d,b.hashes,all),isLatest=all[d.doc_key]?.id===d.id;
    modal.classList.remove('hidden');modal.innerHTML=`<div class="word-export-backdrop" onclick="closeWorkflowReview()"></div><div class="quick-activity-dialog workflow-review" role="dialog" aria-modal="true" aria-label="Duyệt tài liệu"><div class="word-export-head"><h3>${esc(activityAITasks[d.doc_key]?.[0]||d.doc_key)}</h3><button class="icon-btn" aria-label="Đóng" onclick="closeWorkflowReview()">✕</button></div>
      <p>${esc(documentState(d,b,all))}${!isLatest?' · Phiên bản lịch sử':''}</p>${outdated?'<div class="workflow-warning">Dữ kiện hoặc tài liệu tham chiếu đã thay đổi. Tạo bản mới trước khi duyệt.</div>':''}
      <div class="workflow-review-body">${renderPlanRichText(d.result)}</div>
      ${!outdated&&isLatest?`<details class="monthly-edit-details"><summary>Chỉnh sửa nội dung</summary><textarea id="workflowEditText" class="workflow-edit" rows="14">${esc(d.result)}</textarea><button class="btn secondary" onclick="saveWorkflowEdit('${id}')">Lưu thành phiên bản mới</button></details>`:''}
      <div class="quick-actions"><button class="btn secondary" onclick="copyWorkflowDocument('${id}')">Sao chép</button><button class="btn secondary" onclick="exportWorkflowDocument('${id}')">Xuất Word</button>
      <button class="btn primary" ${outdated||!isLatest?'disabled':''} onclick="approveWorkflowDocument('${id}')">Đã kiểm tra · Duyệt bản này</button></div></div>`;
    document.body.classList.add('modal-open');modal.querySelector('button')?.focus();
  };
  window.closeWorkflowReview=()=>{document.getElementById('workflowReviewModal')?.classList.add('hidden');document.body.classList.remove('modal-open');};
  let editingDocument=false;
  window.saveWorkflowEdit=async id=>{
    if(editingDocument)return;
    const text=cleanExportText(document.getElementById('workflowEditText')?.value||'');if(!text)return alert('Nội dung tài liệu không được trống.');
    editingDocument=true;let job=null,token=null;
    try {
      const b=await loadBundle(currentActivityId),all=C.latest(b.documents),d=b.documents.find(x=>x.id===id);
      if(!d)throw new Error('Không tìm thấy bản gốc.');
      if(all[d.doc_key]?.result===text&&C.reusable(all[d.doc_key],b.hashes,all)){window.closeWorkflowReview();return;}
      if(all[d.doc_key]?.id!==id||C.stale(d,b.hashes,all))throw new Error('Dữ kiện hoặc tài liệu đã đổi. Mở bản mới nhất trước khi chỉnh sửa.');
      const input=C.inputHash(d.doc_key,b.hashes);
      const requestId=await docId('manual:'+id,d.doc_key,input,{text});
      job=await rpc('doi_workflow_start',{p_job_id:requestId,p_keys:[d.doc_key],p_activity_id:b.activity.id,p_activity:{},p_force_keys:[]});token=crypto.randomUUID();
      await rpc('doi_workflow_claim',{p_job_id:job.id,p_token:token,p_revision:b.activity.facts_revision,p_facts:C.facts(b.activity),p_context:{...b.context,report_hash:b.hashes.report},p_input_hash:b.hashes.base});
      const documentId=await docId(job.id,d.doc_key,input,d.dependencies);
      await rpc('doi_workflow_save',{p_job_id:job.id,p_token:token,p_document_id:documentId,p_key:d.doc_key,p_title:activityAITasks[d.doc_key][0],p_prompt:'Người dùng chỉnh sửa từ phiên bản '+id,p_result:text,p_dependencies:d.dependencies,p_input_hash:input});
      await rpc('doi_workflow_release',{p_job_id:job.id,p_token:token,p_completed:true,p_error:null});token=null;
      await window.refreshActivityWorkflow();await window.openWorkflowDocument(documentId);toast('Đã lưu phiên bản mới. Tài liệu kế thừa cần được kiểm tra lại.');
    }catch(e){toast(friendly(e),'bad');if(job&&token)await rpc('doi_workflow_release',{p_job_id:job.id,p_token:token,p_completed:false,p_error:friendly(e)}).catch(()=>{});}
    finally{editingDocument=false;}
  };
  window.copyWorkflowDocument=id=>{const d=state.get(currentActivityId)?.documents.find(x=>x.id===id);if(d)copyText(d.result);};
  window.approveWorkflowDocument=async id=>{
    try{
      const b=await loadBundle(currentActivityId),all=C.latest(b.documents),d=b.documents.find(x=>x.id===id);
      if(!d||all[d.doc_key]?.id!==d.id||C.stale(d,b.hashes,all))throw new Error('Tài liệu cần cập nhật trước khi duyệt.');
      await rpc('doi_workflow_approve',{p_document_id:id,p_input_hash:C.inputHash(d.doc_key,b.hashes)});
      await window.refreshActivityWorkflow();window.closeWorkflowReview();toast('Đã duyệt tài liệu.');
    }catch(e){toast(friendly(e),'bad');}
  };
  window.exportWorkflowDocument=async id=>{
    try {
      const b=await loadBundle(currentActivityId),d=b.documents.find(x=>x.id===id),all=C.latest(b.documents);if(!d)return;
      if(C.stale(d,b.hashes,all))return alert('Tài liệu đã lệch dữ kiện hoặc tài liệu tham chiếu. Tạo bản mới trước khi xuất Word.');
      if(d.review_status!=='approved'&&!confirm('Đây là bản nháp chưa duyệt. Xuất Word để kiểm tra?'))return;
      window.closeWorkflowReview();currentActivity=b.activity;currentWordPlanContext=null;
      currentActivityDossierText=cleanExportText(d.result);currentActivityDossierName=dossierSlug(b.activity.activity_name+'-'+activityAITasks[d.doc_key][0]);currentActivityDossierActivityId=b.activity.id;
      await loadDocumentTemplateCache();pendingWordExportType=d.doc_key==='plan'?'plan':d.doc_key==='report'?'report':'script';pendingAIEditedWordText='';pendingWordSourceMode='original';
      document.getElementById('wordExportTemplateSelect').value=pendingWordExportType;document.getElementById('wordNormalizeStructure').checked=true;
      refreshWordExportPreview();document.getElementById('wordExportModal').classList.remove('hidden');document.body.classList.add('modal-open');
    }catch(e){toast(friendly(e),'bad');}
  };
  // The old entry points now use the typed document catalog rather than title guessing.
  exportIndependentActivityDocument=key=>{const d=C.latest(state.get(currentActivityId)?.documents||[])[key==='questions'?'quiz':key];return d?window.exportWorkflowDocument(d.id):alert('Chưa có tài liệu theo dữ kiện chung.');};
})();
