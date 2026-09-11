const cfg = window.APP_CONFIG || {};
function normalizeSupabaseUrl(v){
  let s=(v||"").trim().replace(/\/+$/,"");
  s=s.replace(/\/(rest|auth|storage)\/v1.*$/,"");
  return s;
}
const supabaseUrl=normalizeSupabaseUrl(cfg.SUPABASE_URL);
const configured=!!(supabaseUrl && cfg.SUPABASE_ANON_KEY);
const sb=configured ? supabase.createClient(supabaseUrl,cfg.SUPABASE_ANON_KEY.trim()) : null;
const AI_FUNCTION_NAME=(cfg.AI_FUNCTION_NAME||"doi-ai").trim();
let currentUser=null, demo=!configured, editingScoreId=null, lastScores=[], cachedProfile=null, cachedTemplates=[], historyCache=[];
const $=s=>document.querySelector(s);
const pages={
  home:["Trang chủ","🏠"],profile:["Hồ sơ Liên đội","🏫"],plans:["Kế hoạch Đội","📅"],competition:["Thi đua lớp","🏆"],
  assembly:["Sinh hoạt dưới cờ AI","🎤"],radio:["Phát thanh măng non AI","🎙️"],assistant:["Trợ lý Công tác Đội","🤖"],history:["Lịch sử AI","🕘"]
};
const assistantTasks={
  plan:"Kế hoạch hoạt động Đội",report:"Báo cáo công tác Đội",mc:"Kịch bản MC",fanpage:"Tin bài Fanpage",
  idea:"Ý tưởng hoạt động",game:"Trò chơi tập thể",quiz:"Câu hỏi giao lưu",advice:"Tham mưu",summary:"Tóm tắt văn bản",custom:"Yêu cầu khác"
};

function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
function fmtDate(v){if(!v)return "—";try{return new Date(v).toLocaleString("vi-VN");}catch{return v;}}
function toast(msg,type="good"){const t=$("#toast");if(!t)return;t.textContent=msg;t.className=`toast ${type}`;setTimeout(()=>t.classList.add("hidden"),2600);}
function showApp(user){currentUser=user;$("#loginScreen").classList.add("hidden");$("#appScreen").classList.remove("hidden");$("#userChip").textContent=demo?"Anh Tiến • Demo":(user?.email||"Đã đăng nhập");go("home");}
function showLogin(){$("#appScreen").classList.add("hidden");$("#loginScreen").classList.remove("hidden");}
async function init(){
  if(!configured){demo=true;showApp({email:"demo@local"});return;}
  try{const {data:{session},error}=await sb.auth.getSession();if(error)throw error;if(session)showApp(session.user);else showLogin();}
  catch(e){showLogin();$("#loginMsg").textContent="Lỗi cấu hình Supabase: "+e.message;}
}
$("#loginBtn").onclick=async()=>{if(!configured){demo=true;showApp({email:"demo@local"});return;}$("#loginMsg").textContent="Đang đăng nhập...";const {data,error}=await sb.auth.signInWithPassword({email:$("#email").value.trim(),password:$("#password").value});if(error){$("#loginMsg").textContent="Không đăng nhập được: "+error.message;return;}$("#loginMsg").textContent="";showApp(data.user);};
$("#logoutBtn").onclick=async()=>{if(sb&&!demo)await sb.auth.signOut();cachedProfile=null;cachedTemplates=[];showLogin();};
$("#menuBtn").onclick=()=>document.querySelector(".sidebar").classList.toggle("open");
document.addEventListener("click",e=>{const b=e.target.closest("[data-page]");if(b)go(b.dataset.page);});

async function go(p){
  if(!pages[p])p="home";
  $("#pageTitle").textContent=pages[p][0];document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("active",x.dataset.page===p));
  $("#content").innerHTML=render(p);document.querySelector(".sidebar").classList.remove("open");
  if(p==="home")loadDashboard();
  if(p==="profile")loadProfileForm();
  if(p==="plans")loadPlans();
  if(p==="competition"){bindScorePreview();loadScores();}
  if(["assembly","radio","assistant"].includes(p)){await ensureAIContext();loadAIHistory(p);}
  if(p==="history")loadFullHistory();
}

function render(p){
  if(p==="home")return `<div class="hero"><h1>Xin chào Anh Tiến! 👋</h1><p>V1.4 tập trung vào AI nghiệp vụ, Hồ sơ Liên đội và lịch sử nội dung để phục vụ công việc hằng ngày.</p><div class="hero-actions"><button class="btn primary" data-page="assembly">✨ Soạn sinh hoạt dưới cờ</button><button class="btn secondary" data-page="radio">🎙️ Viết phát thanh</button><button class="btn secondary" data-page="assistant">🤖 Hỏi Trợ lý</button></div></div><div id="dashboardStats" class="dashboard-stats"><div class="dash-stat"><small>Đang tải dữ liệu...</small><b>—</b></div></div><div class="dashboard-columns"><div class="card"><div class="section-title"><h3>⚡ Truy cập nhanh</h3></div><div class="grid">${["profile","plans","competition","assembly","radio","assistant","history"].map(k=>`<div class="quick" data-page="${k}"><div class="emoji">${pages[k][1]}</div><b>${pages[k][0]}</b><small>${quickDesc(k)}</small></div>`).join("")}</div></div><div class="card"><div class="section-title"><h3>🕘 AI gần đây</h3><button class="btn small secondary" data-page="history">Xem tất cả</button></div><div id="homeHistory" class="list"><div class="muted">Đang tải...</div></div></div></div>`;
  if(p==="profile")return `<div class="profile-hint">🏫 <b>Hồ sơ Liên đội là “bộ nhớ nghiệp vụ” của ứng dụng.</b> Anh chỉ nhập một lần. Khi dùng AI, các thông tin phù hợp sẽ được tự đưa vào ngữ cảnh để kết quả sát với đơn vị hơn.</div><div class="card"><div class="section-title"><h3>Hồ sơ Liên đội</h3><span id="profileState" class="save-state"></span></div><div class="form-grid"><div><label>Tên trường</label><input id="pfSchool" value="Trường Tiểu học Võ Văn Ngân"></div><div><label>Tên Liên đội</label><input id="pfLienDoi" placeholder="Ví dụ: Liên đội Trường Tiểu học Võ Văn Ngân"></div><div><label>Năm học</label><input id="pfYear" value="2026-2027"></div><div><label>Tổng phụ trách</label><input id="pfName" placeholder="Họ và tên"></div><div><label>Vai trò</label><input id="pfRole" value="Tổng phụ trách Đội"></div><div><label>Số học sinh</label><input id="pfStudents" type="number" min="0" placeholder="Ví dụ: 1400"></div><div><label>Số lớp</label><input id="pfClasses" type="number" min="0" placeholder="Ví dụ: 40"></div><div><label>Phong cách văn bản</label><input id="pfStyle" value="Tiếng Việt chuẩn miền Nam, rõ ràng, gần gũi, phù hợp học sinh tiểu học"></div><div class="full"><label>Đặc điểm đơn vị</label><textarea id="pfContext" rows="4" placeholder="Ví dụ: trường tiểu học quy mô lớn; ưu tiên hoạt động gần gũi, an toàn, dễ triển khai..."></textarea></div><div class="full"><label>Ngữ cảnh AI ưu tiên</label><textarea id="pfAI" rows="5" placeholder="Ví dụ: ưu tiên giải pháp sáng tạo, chi phí thấp, có tính giáo dục, phù hợp học sinh lớp 1–5; kịch bản cần dễ đọc trước toàn trường..."></textarea></div><div class="full action-row"><button class="btn primary" onclick="saveProfile()">💾 Lưu Hồ sơ Liên đội</button></div></div></div>`;
  if(p==="plans")return `<div class="toolbar"><input id="planTitle" placeholder="Tên kế hoạch"><input id="planDate" type="date"><select id="planStatus"><option>Chưa thực hiện</option><option>Đang thực hiện</option><option>Hoàn thành</option></select><button class="btn primary" onclick="addPlan()">＋ Lưu kế hoạch</button></div><div id="planList" class="card list">Đang tải...</div>`;
  if(p==="competition")return competitionHTML();
  if(p==="assembly")return aiModuleHTML("assembly");
  if(p==="radio")return aiModuleHTML("radio");
  if(p==="assistant")return assistantHTML();
  if(p==="history")return `<div class="history-toolbar"><input id="historySearch" placeholder="🔎 Tìm theo chủ đề, yêu cầu hoặc nội dung..." oninput="filterHistory()"><select id="historyModule" onchange="filterHistory()"><option value="all">Tất cả mô-đun</option><option value="assembly">Sinh hoạt dưới cờ</option><option value="radio">Phát thanh măng non</option><option value="assistant">Trợ lý Công tác Đội</option></select><select id="historyLimit" onchange="loadFullHistory()"><option value="20">20 nội dung</option><option value="50">50 nội dung</option><option value="100">100 nội dung</option></select></div><div id="historyList" class="history-list"><div class="card">Đang tải...</div></div>`;
  return "";
}
function quickDesc(k){return {profile:"Cấu hình ngữ cảnh trường",plans:"Theo dõi kế hoạch",competition:"Nhập điểm và xếp hạng",assembly:"Kịch bản dùng ngay",radio:"Bản tin 3–7 phút",assistant:"9 nhóm tác vụ nghiệp vụ",history:"Tìm lại nội dung đã tạo"}[k]||"";}

function competitionHTML(){return `<div class="competition-head"><div><b>🏆 Bảng thi đua tuần</b><div class="muted">Nhập từng tiêu chí → tự tính tổng → xếp hạng tự động</div></div><div class="filterbar"><label>Tuần <input id="filterWeek" type="number" min="1" max="53" value="1" style="width:75px"></label><button class="btn secondary" onclick="loadScores()">Xem</button><button class="btn secondary" onclick="exportCSV()">⬇ Xuất CSV</button></div></div><div class="card"><div class="score-form"><div><label>Tuần *</label><input id="week" type="number" min="1" max="53" value="1"></div><div><label>Lớp *</label><input id="className" list="classList" placeholder="Ví dụ: 4/3"><datalist id="classList">${classOptions()}</datalist></div><div><label>Năm học</label><input id="schoolYear" value="2026-2027"></div><div><label>Ngày ghi nhận</label><input id="scoreDate" type="date"></div><div><label>Nề nếp</label><input class="score-part" id="discipline" type="number" step="0.5" value="0"></div><div><label>Vệ sinh</label><input class="score-part" id="hygiene" type="number" step="0.5" value="0"></div><div><label>Chuyên cần</label><input class="score-part" id="attendance" type="number" step="0.5" value="0"></div><div><label>Đồng phục</label><input class="score-part" id="uniform" type="number" step="0.5" value="0"></div><div><label>Phong trào</label><input class="score-part" id="movement" type="number" step="0.5" value="0"></div><div><label>Điểm cộng</label><input class="score-part" id="bonus" type="number" step="0.5" value="0"></div><div><label>Điểm trừ</label><input class="score-part" id="penalty" type="number" step="0.5" value="0"></div><div><label>Tổng dự kiến</label><div id="totalPreview" class="total-preview">0 điểm</div></div><div class="full"><label>Ghi chú / vi phạm / thành tích nổi bật</label><textarea id="scoreNotes" rows="2"></textarea></div><div class="full action-row"><button id="saveScoreBtn" class="btn primary" onclick="saveScore()">＋ Lưu điểm thi đua</button><button id="cancelEditBtn" class="btn secondary hidden" onclick="cancelScoreEdit()">Hủy chỉnh sửa</button></div></div></div><div id="scoreStats" class="score-summary"></div><div class="card table-wrap"><table><thead><tr><th>Hạng</th><th>Lớp</th><th>Nề nếp</th><th>Vệ sinh</th><th>Chuyên cần</th><th>Đồng phục</th><th>Phong trào</th><th>+ / −</th><th>Tổng</th><th>Thao tác</th></tr></thead><tbody id="scoreBody"><tr><td colspan="10">Đang tải...</td></tr></tbody></table></div>`;}

function aiModuleHTML(module){
  const assembly=module==="assembly";
  return `<div class="ai-layout"><div class="card ai-card"><h3>${assembly?"🎤 Sinh hoạt dưới cờ AI Pro":"🎙️ Phát thanh măng non AI Pro"}</h3><div class="ai-form"><div class="full"><label>Chủ đề *</label><input id="topic" value="${assembly?"An toàn giao thông":"Mỗi ngày một việc tốt"}"></div>${assembly?`<div><label>Tuần</label><input id="weekAI" type="number" min="1" max="53" placeholder="Ví dụ: 6"></div>`:`<div><label>Chủ điểm tháng</label><input id="monthlyTheme" placeholder="Ví dụ: Uống nước nhớ nguồn"></div>`}<div><label>Đối tượng</label><select id="audience"><option>Toàn trường (lớp 1–5)</option><option>Khối 1–2</option><option>Khối 3–5</option><option>Đội viên</option><option>Sao nhi đồng</option></select></div><div><label>Thời lượng</label><select id="duration">${assembly?"<option>10 phút</option><option selected>15 phút</option><option>20 phút</option>":"<option>3 phút</option><option selected>5 phút</option><option>7 phút</option>"}</select></div><div><label>${assembly?"Hình thức":"Phong cách"}</label><select id="format"><option>${assembly?"MC + giao lưu":"Hai phát thanh viên"}</option><option>${assembly?"Kể chuyện + tương tác":"Một phát thanh viên"}</option><option>${assembly?"Tình huống + hỏi đáp":"Tin ngắn + thông điệp"}</option></select></div><div><label>Mẫu nghiệp vụ</label><select id="templateSelect"><option value="">Mặc định V1.4</option></select></div><div class="full"><label>Mục tiêu / nội dung cần nhấn mạnh</label><textarea id="objectives" rows="3" placeholder="Ví dụ: giúp học sinh nhớ 3 nguyên tắc an toàn; có thông điệp hành động rõ ràng..."></textarea></div><div class="full"><label>Yêu cầu thêm</label><textarea id="extra" rows="4" placeholder="Ví dụ: có 3 câu hỏi tương tác; lời dẫn tự nhiên; có phần tuyên dương..."></textarea></div></div><div class="template-note" id="templateNote">AI sẽ kết hợp Hồ sơ Liên đội + mẫu nghiệp vụ + các thông tin anh nhập.</div><div class="privacy-note">🔐 Không nhập dữ liệu cá nhân nhạy cảm của học sinh. OpenAI API key vẫn được giữ trong Supabase Secrets.</div><div class="ai-actions"><button id="aiGenerateBtn" class="btn primary" onclick="generateAI('${module}')">✨ Tạo nội dung AI</button><button class="btn secondary" onclick="copyAIResult('result')">📋 Sao chép</button><button class="btn secondary" onclick="downloadText('result','${assembly?"sinh-hoat-duoi-co":"phat-thanh-mang-non"}')">⬇ Tải .txt</button></div><div id="aiStatus" class="ai-status"></div></div><div><div class="card"><div class="section-title"><h3>📝 Nội dung AI</h3><span class="pill green">AI thật</span></div><div id="result" class="result">Nhập yêu cầu rồi bấm “Tạo nội dung AI”.</div></div><div class="card history-mini"><div class="section-title"><b>Lịch sử gần đây</b><button class="btn small secondary" data-page="history">Xem tất cả</button></div><div id="aiHistory">Đang tải...</div></div></div></div>`;
}
function assistantHTML(){
  return `<div class="ai-layout"><div class="card ai-card"><h3>🤖 Trợ lý AI Công tác Đội</h3><div class="muted">Chọn tác vụ để AI tự áp dụng cấu trúc phù hợp.</div><div id="taskChips" class="task-chips">${Object.entries(assistantTasks).map(([k,v],i)=>`<button class="task-chip ${i===0?"active":""}" data-task="${k}" onclick="selectTask('${k}')">${esc(v)}</button>`).join("")}</div><input type="hidden" id="assistantTask" value="plan"><div class="ai-form"><div><label>Mẫu nghiệp vụ</label><select id="templateSelect"><option value="">Tự chọn theo tác vụ</option></select></div><div><label>Đối tượng / phạm vi</label><input id="assistantAudience" placeholder="Ví dụ: toàn trường, giáo viên, phụ huynh..."></div><div class="full"><label>Yêu cầu *</label><textarea id="ask" rows="9" placeholder="Ví dụ: Xây dựng kế hoạch tổ chức Ngày hội Thiếu nhi vui khỏe trong tháng 3, quy mô toàn trường, ưu tiên hoạt động chi phí thấp..."></textarea></div></div><div class="template-note" id="templateNote">Đang dùng tác vụ: <b>Kế hoạch hoạt động Đội</b>.</div><div class="privacy-note">🔐 Chỉ gửi thông tin cần thiết cho nhiệm vụ. Không nhập hồ sơ cá nhân nhạy cảm của học sinh.</div><div class="ai-actions"><button id="aiGenerateBtn" class="btn primary" onclick="generateAI('assistant')">✨ Gửi Trợ lý AI</button><button class="btn secondary" onclick="copyAIResult('answer')">📋 Sao chép</button><button class="btn secondary" onclick="downloadText('answer','tro-ly-cong-tac-doi')">⬇ Tải .txt</button></div><div id="aiStatus" class="ai-status"></div></div><div><div class="card"><div class="section-title"><h3>💡 Kết quả</h3><span class="pill green">Có Hồ sơ Liên đội</span></div><div id="answer" class="result">Chọn tác vụ, nhập yêu cầu và gửi Trợ lý AI.</div></div><div class="card history-mini"><div class="section-title"><b>Lịch sử gần đây</b><button class="btn small secondary" data-page="history">Xem tất cả</button></div><div id="aiHistory">Đang tải...</div></div></div></div>`;
}

async function loadDashboard(){
  const stats=$("#dashboardStats"), recent=$("#homeHistory"); if(!stats)return;
  if(demo){stats.innerHTML=`<div class="dash-stat"><small>Chế độ</small><b>Demo</b></div>`;recent.innerHTML=`<div class="muted">Kết nối Supabase để xem lịch sử AI.</div>`;return;}
  try{
    const [p,s,h,pr]=await Promise.all([
      sb.from("plans").select("id",{count:"exact",head:true}),
      sb.from("competition_scores").select("id",{count:"exact",head:true}),
      sb.from("ai_history").select("id",{count:"exact",head:true}),
      sb.from("lien_doi_profile").select("id",{count:"exact",head:true}).eq("user_id",currentUser.id)
    ]);
    stats.innerHTML=`<div class="dash-stat"><small>Kế hoạch</small><b>${p.count??0}</b></div><div class="dash-stat"><small>Bản ghi thi đua</small><b>${s.count??0}</b></div><div class="dash-stat"><small>Nội dung AI đã lưu</small><b>${h.count??0}</b></div><div class="dash-stat"><small>Hồ sơ Liên đội</small><b>${(pr.count??0)>0?"✓":"!"}</b></div>`;
    const {data,error}=await sb.from("ai_history").select("id,module,title,topic,prompt,created_at").order("created_at",{ascending:false}).limit(5);
    if(error)throw error;
    recent.innerHTML=data?.length?data.map(x=>`<div class="row"><div class="grow"><b>${esc(x.title||x.topic||moduleName(x.module))}</b><div class="meta">${moduleName(x.module)} • ${fmtDate(x.created_at)}</div></div></div>`).join(""):`<div class="empty">Chưa có lịch sử AI.</div>`;
  }catch(e){stats.innerHTML=`<div class="dash-stat"><small>Không tải được Dashboard</small><b>!</b><div class="muted">${esc(e.message)}</div></div>`;}
}

async function ensureAIContext(){await Promise.all([loadProfileCache(),loadTemplates()]);populateTemplateSelect();}
async function loadProfileCache(force=false){
  if(demo)return null;if(cachedProfile&&!force)return cachedProfile;
  const {data,error}=await sb.from("lien_doi_profile").select("*").eq("user_id",currentUser.id).maybeSingle();
  if(error){console.warn("Profile:",error.message);return null;}cachedProfile=data||null;return cachedProfile;
}
async function loadTemplates(force=false){
  if(demo)return [];if(cachedTemplates.length&&!force)return cachedTemplates;
  const {data,error}=await sb.from("ai_templates").select("*").eq("is_active",true).order("sort_order",{ascending:true});
  if(error){console.warn("Templates:",error.message);return [];}cachedTemplates=data||[];return cachedTemplates;
}
function populateTemplateSelect(){
  const sel=$("#templateSelect");if(!sel)return;
  const currentPage=[...document.querySelectorAll("nav button")].find(x=>x.classList.contains("active"))?.dataset.page;
  let arr=cachedTemplates;
  if(currentPage==="assembly")arr=arr.filter(x=>x.module==="assembly");
  if(currentPage==="radio")arr=arr.filter(x=>x.module==="radio");
  if(currentPage==="assistant")arr=arr.filter(x=>x.module==="assistant");
  const first=sel.options[0]?.outerHTML||'<option value="">Mặc định</option>';
  sel.innerHTML=first+arr.map(x=>`<option value="${esc(x.template_code)}">${esc(x.template_name)}</option>`).join("");
  sel.onchange=()=>updateTemplateNote();
}
function selectedTemplate(){const code=$("#templateSelect")?.value;if(!code)return null;return cachedTemplates.find(x=>x.template_code===code)||null;}
function updateTemplateNote(){const t=selectedTemplate(),box=$("#templateNote");if(!box)return;box.innerHTML=t?`Mẫu đang dùng: <b>${esc(t.template_name)}</b> — ${esc(t.description||"")}`:`AI sẽ kết hợp Hồ sơ Liên đội + mẫu nghiệp vụ + các thông tin anh nhập.`;}

async function loadProfileForm(){
  if(demo){$("#profileState").textContent="Demo: chưa lưu lên Supabase";return;}
  const p=await loadProfileCache(true);if(!p){$("#profileState").textContent="Chưa có hồ sơ — hãy nhập và lưu lần đầu.";return;}
  const map={pfSchool:p.school_name,pfLienDoi:p.lien_doi_name,pfYear:p.school_year,pfName:p.tong_phu_trach_name,pfRole:p.role_name,pfStudents:p.student_count,pfClasses:p.class_count,pfStyle:p.writing_style,pfContext:p.school_context,pfAI:p.ai_context};
  Object.entries(map).forEach(([id,v])=>{if($("#"+id)&&v!==null&&v!==undefined)$("#"+id).value=v;});$("#profileState").textContent="Đã tải hồ sơ.";
}
async function saveProfile(){
  if(demo)return alert("Chế độ Demo chưa thể lưu Hồ sơ Liên đội lên Supabase.");
  const row={user_id:currentUser.id,school_name:$("#pfSchool").value.trim(),lien_doi_name:$("#pfLienDoi").value.trim(),school_year:$("#pfYear").value.trim(),tong_phu_trach_name:$("#pfName").value.trim(),role_name:$("#pfRole").value.trim(),student_count:Number($("#pfStudents").value)||null,class_count:Number($("#pfClasses").value)||null,school_context:$("#pfContext").value.trim(),writing_style:$("#pfStyle").value.trim(),ai_context:$("#pfAI").value.trim(),updated_at:new Date().toISOString()};
  const {data,error}=await sb.from("lien_doi_profile").upsert(row,{onConflict:"user_id"}).select().single();
  if(error)return alert("Chưa lưu được Hồ sơ Liên đội: "+error.message);cachedProfile=data;$("#profileState").textContent="✓ Đã lưu";toast("Đã lưu Hồ sơ Liên đội.");
}
function profileForAI(){const p=cachedProfile||{};return {school_name:p.school_name||"Trường Tiểu học Võ Văn Ngân",lien_doi_name:p.lien_doi_name||"",school_year:p.school_year||"2026-2027",tong_phu_trach_name:p.tong_phu_trach_name||"",role_name:p.role_name||"Tổng phụ trách Đội",student_count:p.student_count||null,class_count:p.class_count||null,school_context:p.school_context||"",writing_style:p.writing_style||"Tiếng Việt chuẩn miền Nam, rõ ràng, gần gũi, phù hợp học sinh tiểu học",ai_context:p.ai_context||""};}

async function addPlan(){const item={title:$("#planTitle").value.trim(),plan_date:$("#planDate").value||null,status:$("#planStatus").value};if(!item.title)return alert("Anh nhập tên kế hoạch trước.");if(demo){const arr=JSON.parse(localStorage.getItem("plans")||"[]");arr.push({...item,id:crypto.randomUUID()});localStorage.setItem("plans",JSON.stringify(arr));loadPlans();return;}item.created_by=currentUser.id;const {error}=await sb.from("plans").insert(item);if(error)return alert(error.message);loadPlans();toast("Đã lưu kế hoạch.");}
async function loadPlans(){let arr=[];if(demo)arr=JSON.parse(localStorage.getItem("plans")||"[]");else{const {data,error}=await sb.from("plans").select("*").order("plan_date",{ascending:true});if(error){$("#planList").textContent=error.message;return;}arr=data;}$("#planList").innerHTML=arr.length?arr.map(x=>`<div class="row"><div class="grow"><b>${esc(x.title)}</b><div class="meta">${esc(x.plan_date||"Chưa đặt ngày")}</div></div><span class="pill">${esc(x.status)}</span></div>`).join(""):`<div class="empty">Chưa có kế hoạch.</div>`;}

function classOptions(){let s="";for(let g=1;g<=5;g++)for(let c=1;c<=10;c++)s+=`<option value="${g}/${c}">`;return s;}
function num(id){return Number($(id)?.value||0);}function calcFormTotal(){return num("#discipline")+num("#hygiene")+num("#attendance")+num("#uniform")+num("#movement")+num("#bonus")-num("#penalty");}
function bindScorePreview(){document.querySelectorAll(".score-part").forEach(x=>x.addEventListener("input",()=>{$("#totalPreview").textContent=calcFormTotal().toFixed(1).replace(".0","")+" điểm";}));const d=new Date();$("#scoreDate").value=d.toISOString().slice(0,10);}
function scoreTotal(x){return Number(x.final_total ?? (Number(x.discipline||0)+Number(x.hygiene||0)+Number(x.attendance||0)+Number(x.uniform||0)+Number(x.movement||0)+Number(x.bonus||0)-Number(x.penalty||0)));}
function formScore(){return {week_no:Number($("#week").value),class_name:$("#className").value.trim(),school_year:$("#schoolYear").value.trim()||"2026-2027",score_date:$("#scoreDate").value||null,discipline:num("#discipline"),hygiene:num("#hygiene"),attendance:num("#attendance"),uniform:num("#uniform"),movement:num("#movement"),bonus:num("#bonus"),penalty:num("#penalty"),notes:$("#scoreNotes").value.trim()};}
async function saveScore(){const item=formScore();if(!item.week_no||item.week_no<1)return alert("Anh nhập số tuần hợp lệ.");if(!item.class_name)return alert("Anh nhập tên lớp.");if(demo){let arr=JSON.parse(localStorage.getItem("scores_v12")||"[]");if(editingScoreId)arr=arr.map(x=>x.id===editingScoreId?{...x,...item,final_total:calcFormTotal()}:x);else arr.push({...item,id:crypto.randomUUID(),final_total:calcFormTotal()});localStorage.setItem("scores_v12",JSON.stringify(arr));afterSaveScore();return;}item.created_by=currentUser.id;let q=editingScoreId?sb.from("competition_scores").update(item).eq("id",editingScoreId):sb.from("competition_scores").insert(item);const {error}=await q;if(error)return alert("Chưa lưu được: "+error.message);afterSaveScore();toast("Đã lưu điểm thi đua.");}
function afterSaveScore(){const w=$("#week").value;$("#filterWeek").value=w;cancelScoreEdit(false);loadScores();}
function cancelScoreEdit(clear=true){editingScoreId=null;$("#saveScoreBtn").textContent="＋ Lưu điểm thi đua";$("#cancelEditBtn").classList.add("hidden");if(clear){["#className","#scoreNotes"].forEach(id=>$(id).value="");["#discipline","#hygiene","#attendance","#uniform","#movement","#bonus","#penalty"].forEach(id=>$(id).value=0);$("#totalPreview").textContent="0 điểm";}}
async function loadScores(){const week=Number($("#filterWeek")?.value||1);let arr=[];if(demo)arr=JSON.parse(localStorage.getItem("scores_v12")||"[]").filter(x=>Number(x.week_no)===week);else{const {data,error}=await sb.from("competition_scores").select("*").eq("week_no",week);if(error){$("#scoreBody").innerHTML=`<tr><td colspan="10">${esc(error.message)}</td></tr>`;return;}arr=data||[];}arr.sort((a,b)=>scoreTotal(b)-scoreTotal(a)||String(a.class_name).localeCompare(String(b.class_name),"vi"));lastScores=arr;const top=arr[0],avg=arr.length?arr.reduce((s,x)=>s+scoreTotal(x),0)/arr.length:0;$("#scoreStats").innerHTML=`<div class="stat"><small>Tuần đang xem</small><b>${week}</b></div><div class="stat"><small>Số lớp đã nhập</small><b>${arr.length}</b></div><div class="stat"><small>Dẫn đầu</small><b>${top?esc(top.class_name):"—"}</b></div><div class="stat"><small>Điểm trung bình</small><b>${avg?avg.toFixed(1):"—"}</b></div>`;$("#scoreBody").innerHTML=arr.length?arr.map((x,i)=>`<tr><td class="${i===0?"rank1":""}">${i===0?"🥇 ":i===1?"🥈 ":i===2?"🥉 ":""}${i+1}</td><td><b>${esc(x.class_name)}</b><div class="muted">${esc(x.notes||"")}</div></td><td>${x.discipline||0}</td><td>${x.hygiene||0}</td><td>${x.attendance||0}</td><td>${x.uniform||0}</td><td>${x.movement||0}</td><td>+${x.bonus||0} / −${x.penalty||0}</td><td><span class="badge-good"><b>${scoreTotal(x)}</b></span></td><td><div class="action-row"><button class="btn small secondary" onclick='editScore(${JSON.stringify(JSON.stringify(x))})'>Sửa</button><button class="btn small danger" onclick="deleteScore('${x.id}')">Xóa</button></div></td></tr>`).join(""):`<tr><td colspan="10">Tuần ${week} chưa có dữ liệu thi đua.</td></tr>`;}
function editScore(raw){const x=JSON.parse(raw);editingScoreId=x.id;$("#week").value=x.week_no;$("#className").value=x.class_name;$("#schoolYear").value=x.school_year||"2026-2027";$("#scoreDate").value=x.score_date||"";["discipline","hygiene","attendance","uniform","movement","bonus","penalty"].forEach(k=>$("#"+k).value=x[k]||0);$("#scoreNotes").value=x.notes||"";$("#totalPreview").textContent=scoreTotal(x)+" điểm";$("#saveScoreBtn").textContent="💾 Cập nhật điểm";$("#cancelEditBtn").classList.remove("hidden");window.scrollTo({top:0,behavior:"smooth"});}
async function deleteScore(id){if(!confirm("Xóa bản ghi thi đua này?"))return;if(demo){let arr=JSON.parse(localStorage.getItem("scores_v12")||"[]").filter(x=>x.id!==id);localStorage.setItem("scores_v12",JSON.stringify(arr));loadScores();return;}const {error}=await sb.from("competition_scores").delete().eq("id",id);if(error)return alert(error.message);loadScores();}
function csvCell(v){return `"${String(v??"").replace(/"/g,'""')}"`;}
function exportCSV(){if(!lastScores.length)return alert("Chưa có dữ liệu để xuất.");const rows=[["Hạng","Lớp","Tuần","Nề nếp","Vệ sinh","Chuyên cần","Đồng phục","Phong trào","Điểm cộng","Điểm trừ","Tổng","Ghi chú"],...lastScores.map((x,i)=>[i+1,x.class_name,x.week_no,x.discipline,x.hygiene,x.attendance,x.uniform,x.movement,x.bonus||0,x.penalty||0,scoreTotal(x),x.notes||""])];const csv="\uFEFF"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`thi-dua-tuan-${$("#filterWeek").value}.csv`;a.click();URL.revokeObjectURL(a.href);}

function selectTask(k){if(!assistantTasks[k])return;$("#assistantTask").value=k;document.querySelectorAll(".task-chip").forEach(x=>x.classList.toggle("active",x.dataset.task===k));const note=$("#templateNote");if(note)note.innerHTML=`Đang dùng tác vụ: <b>${esc(assistantTasks[k])}</b>. AI sẽ ưu tiên cấu trúc phù hợp với tác vụ này.`;autoChooseTemplate(k);}
function autoChooseTemplate(k){const sel=$("#templateSelect");if(!sel)return;const map={plan:"PLAN_STANDARD",report:"REPORT_STANDARD",mc:"MC_STANDARD",fanpage:"FANPAGE_STANDARD"};sel.value=map[k]||"";}
function buildAIBody(module){
  const t=selectedTemplate();const base={module,profile:profileForAI(),template_code:t?.template_code||"",template_name:t?.template_name||"",template_prompt:t?.prompt_template||""};
  if(module==="assistant")return {...base,task_type:$("#assistantTask").value,task_name:assistantTasks[$("#assistantTask").value]||"Yêu cầu khác",audience:$("#assistantAudience").value.trim(),prompt:$("#ask").value.trim()};
  return {...base,topic:$("#topic").value.trim(),duration:$("#duration").value,audience:$("#audience").value,format:$("#format").value,objectives:$("#objectives").value.trim(),extra:$("#extra").value.trim(),week_no:module==="assembly"?$("#weekAI").value:"",monthly_theme:module==="radio"?$("#monthlyTheme").value.trim():""};
}
async function generateAI(module){
  if(demo||!sb)return alert("Để dùng AI thật, anh cần cấu hình Supabase và đăng nhập trước.");
  await loadProfileCache();await loadTemplates();
  const outputId=module==="assistant"?"answer":"result",out=$("#"+outputId),btn=$("#aiGenerateBtn"),status=$("#aiStatus"),body=buildAIBody(module);
  if(module==="assistant"&&!body.prompt)return alert("Anh nhập yêu cầu trước.");if(module!=="assistant"&&!body.topic)return alert("Anh nhập chủ đề trước.");
  btn.disabled=true;status.textContent="AI đang xử lý theo Hồ sơ Liên đội và mẫu nghiệp vụ...";out.textContent="Đang tạo nội dung...";
  try{
    const {data,error}=await sb.functions.invoke(AI_FUNCTION_NAME,{body});if(error)throw error;if(data?.error)throw new Error(data.error);
    const text=data?.text||"";if(!text)throw new Error("AI chưa trả về nội dung.");out.textContent=text;status.textContent=`✓ Đã tạo bằng ${data.model||"OpenAI"}.`;
    const history=historyRow(module,body,text);const {error:historyError}=await sb.from("ai_history").insert(history);
    if(historyError)status.textContent += " Chưa lưu lịch sử: "+historyError.message;else{loadAIHistory(module);toast("Đã tạo và lưu vào Lịch sử AI.");}
  }catch(e){out.textContent="Chưa tạo được nội dung.";status.textContent="Lỗi: "+(e?.message||e);}
  finally{btn.disabled=false;}
}
function historyRow(module,b,text){
  let prompt="",title="",topic=b.topic||"";
  if(module==="assistant"){title=b.task_name||"Trợ lý Công tác Đội";prompt=b.prompt;}
  else{title=module==="assembly"?`Sinh hoạt dưới cờ: ${b.topic}`:`Phát thanh măng non: ${b.topic}`;prompt=[`Chủ đề: ${b.topic}`,b.duration&&`Thời lượng: ${b.duration}`,b.audience&&`Đối tượng: ${b.audience}`,b.format&&`Hình thức: ${b.format}`,b.objectives&&`Mục tiêu: ${b.objectives}`,b.extra&&`Yêu cầu thêm: ${b.extra}`].filter(Boolean).join("; ");}
  return {module,title,topic,prompt,result:text,duration:b.duration||null,audience:b.audience||null,extra:b.extra||null,created_by:currentUser.id,updated_at:new Date().toISOString()};
}
async function loadAIHistory(module){
  const box=$("#aiHistory");if(!box)return;if(demo){box.innerHTML='<div class="muted">Lịch sử AI chỉ lưu khi đã kết nối Supabase.</div>';return;}
  const {data,error}=await sb.from("ai_history").select("id,module,title,topic,prompt,result,created_at").eq("module",module).order("created_at",{ascending:false}).limit(5);if(error){box.textContent=error.message;return;}
  box.innerHTML=data?.length?data.map(x=>`<div class="history-item"><b>${esc(x.title||x.topic||moduleName(x.module))}</b><div class="muted">${fmtDate(x.created_at)}</div><div class="history-result">${esc(x.result)}</div><div class="history-actions"><button class="btn small secondary" onclick='copyHistory(${JSON.stringify(JSON.stringify({result:x.result}))})'>📋 Sao chép</button></div></div>`).join(""):'<div class="muted">Chưa có lịch sử.</div>';
}
function moduleName(m){return m==="assembly"?"Sinh hoạt dưới cờ":m==="radio"?"Phát thanh măng non":"Trợ lý Công tác Đội";}
async function loadFullHistory(){
  const box=$("#historyList");if(!box)return;if(demo){box.innerHTML='<div class="card">Lịch sử AI cần kết nối Supabase.</div>';return;}
  const limit=Number($("#historyLimit")?.value||20);const {data,error}=await sb.from("ai_history").select("id,module,title,topic,prompt,result,duration,audience,extra,created_at").order("created_at",{ascending:false}).limit(limit);if(error){box.innerHTML=`<div class="card">${esc(error.message)}</div>`;return;}historyCache=data||[];filterHistory();
}
function filterHistory(){
  const q=($("#historySearch")?.value||"").trim().toLowerCase(),m=$("#historyModule")?.value||"all";let arr=historyCache.filter(x=>(m==="all"||x.module===m)&&(!q||[x.title,x.topic,x.prompt,x.result].join(" ").toLowerCase().includes(q)));renderHistory(arr);
}
function renderHistory(arr){const box=$("#historyList");if(!box)return;box.innerHTML=arr.length?arr.map(x=>`<div class="history-card" id="h-${x.id}"><div class="history-card-head"><div><span class="module-badge">${moduleName(x.module)}</span><h4>${esc(x.title||x.topic||moduleName(x.module))}</h4><div class="muted">${fmtDate(x.created_at)}${x.duration?` • ${esc(x.duration)}`:""}${x.audience?` • ${esc(x.audience)}`:""}</div></div><div class="history-actions"><button class="btn small secondary" onclick="toggleHistory('${x.id}')">Mở/thu gọn</button><button class="btn small secondary" onclick="copyHistoryById('${x.id}')">📋 Sao chép</button><button class="btn small soft" onclick="reuseHistory('${x.id}')">↻ Dùng lại</button><button class="btn small danger" onclick="deleteHistory('${x.id}')">Xóa</button></div></div><div class="muted" style="margin-top:8px"><b>Yêu cầu:</b> ${esc(x.prompt||"")}</div><div class="preview">${esc(x.result)}</div></div>`).join(""):`<div class="card empty">Không tìm thấy nội dung phù hợp.</div>`;}
function toggleHistory(id){$("#h-"+id)?.classList.toggle("expanded");}
async function copyHistory(raw){const x=JSON.parse(raw);await copyText(x.result||"");}
async function copyHistoryById(id){const x=historyCache.find(y=>y.id===id);if(x)await copyText(x.result||"");}
async function copyText(text){try{await navigator.clipboard.writeText(text);toast("Đã sao chép nội dung.");}catch{alert("Trình duyệt không cho sao chép tự động. Anh bôi đen nội dung và nhấn Ctrl+C.");}}
async function copyAIResult(id){const text=$("#"+id)?.textContent||"";if(text)await copyText(text);}
function downloadText(id,name){const text=$("#"+id)?.textContent||"";if(!text)return alert("Chưa có nội dung để tải.");const blob=new Blob(["\uFEFF"+text],{type:"text/plain;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`${name}-${new Date().toISOString().slice(0,10)}.txt`;a.click();URL.revokeObjectURL(a.href);}
function reuseHistory(id){const x=historyCache.find(y=>y.id===id);if(!x)return;if(x.module==="assistant"){go("assistant").then(()=>{$("#ask").value=x.prompt||"";});}else{go(x.module).then(()=>{$("#topic").value=x.topic||"";if(x.duration)$("#duration").value=x.duration;if(x.audience)$("#audience").value=x.audience;if(x.extra)$("#extra").value=x.extra;});}}
async function deleteHistory(id){if(!confirm("Xóa nội dung này khỏi Lịch sử AI?"))return;const {error}=await sb.from("ai_history").delete().eq("id",id);if(error)return alert(error.message);historyCache=historyCache.filter(x=>x.id!==id);filterHistory();toast("Đã xóa khỏi lịch sử.");}

init();
