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
let currentUser=null, demo=!configured, editingScoreId=null, lastScores=[], cachedProfile=null, cachedTemplates=[], historyCache=[], documentTemplateCache=[];
let activityCache=[], editingActivityId=null, selectedActivityId=null;
const $=s=>document.querySelector(s);
const pages={
  home:["Trang chủ","🏠"],profile:["Hồ sơ Liên đội","🏫"],wordsettings:["Mẫu văn bản","📝"],plans:["Kế hoạch Đội","📅"],activities:["Hoạt động & Sự kiện","🎯"],competition:["Thi đua lớp","🏆"],
  assembly:["Sinh hoạt dưới cờ AI","🎤"],radio:["Phát thanh măng non AI","🎙️"],assistant:["Trợ lý Công tác Đội","🤖"],history:["Lịch sử AI","🕘"]
};
const assistantTasks={
  plan:"Kế hoạch hoạt động Đội",report:"Báo cáo công tác Đội",mc:"Kịch bản MC",fanpage:"Tin bài Fanpage",
  idea:"Ý tưởng hoạt động",game:"Trò chơi tập thể",quiz:"Câu hỏi giao lưu",advice:"Tham mưu",summary:"Tóm tắt văn bản",custom:"Yêu cầu khác"
};

function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}

function cleanExportText(text){
  return String(text??"")
    .replace(/^#{1,6}\s*/gm,"")
    .replace(/\*\*(.*?)\*\*/g,"$1")
    .replace(/__(.*?)__/g,"$1")
    .replace(/^\s*[-*_]{3,}\s*$/gm,"")
    .replace(/^\s*>\s?/gm,"")
    .replace(/`{1,3}/g,"")
    .replace(/^\s*\*\s+/gm,"")
    .replace(/\n{3,}/g,"\n\n")
    .trim();
}

function fmtDate(v){if(!v)return "—";try{return new Date(v).toLocaleString("vi-VN");}catch{return v;}}
function toast(msg,type="good"){const t=$("#toast");if(!t)return;t.textContent=msg;t.className=`toast ${type}`;setTimeout(()=>t.classList.add("hidden"),2600);}
async function showApp(user){
  currentUser=user;
  $("#loginScreen").classList.add("hidden");
  $("#appScreen").classList.remove("hidden");
  $("#userChip").textContent=demo?"Demo":(user?.email||"Đã đăng nhập");
  if(!demo){
    await loadProfileCache(true);
    applyBranding(cachedProfile);
  }else{
    applyBranding(loadLocalBranding());
  }
  go("home");
}
function showLogin(){
  $("#appScreen").classList.add("hidden");
  $("#loginScreen").classList.remove("hidden");
  applyBranding(loadLocalBranding());
}
async function init(){
  applyBranding(loadLocalBranding());
  if(!configured){demo=true;await showApp({email:"demo@local"});return;}
  try{
    const {data:{session},error}=await sb.auth.getSession();
    if(error)throw error;
    if(session)await showApp(session.user); else showLogin();
  }catch(e){
    showLogin();
    $("#loginMsg").textContent="Lỗi cấu hình Supabase: "+e.message;
  }
}
$("#loginBtn").onclick=async()=>{
  if(!configured){demo=true;await showApp({email:"demo@local"});return;}
  $("#loginMsg").textContent="Đang đăng nhập...";
  const {data,error}=await sb.auth.signInWithPassword({email:$("#email").value.trim(),password:$("#password").value});
  if(error){$("#loginMsg").textContent="Không đăng nhập được: "+error.message;return;}
  $("#loginMsg").textContent="";
  await showApp(data.user);
};
$("#logoutBtn").onclick=async()=>{if(sb&&!demo)await sb.auth.signOut();cachedProfile=null;cachedTemplates=[];documentTemplateCache=[];showLogin();};
$("#menuBtn").onclick=()=>document.querySelector(".sidebar").classList.toggle("open");
document.addEventListener("click",e=>{const b=e.target.closest("[data-page]");if(b)go(b.dataset.page);});

async function go(p){
  if(!pages[p])p="home";
  $("#pageTitle").textContent=pages[p][0];document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("active",x.dataset.page===p));
  $("#content").innerHTML=render(p);document.querySelector(".sidebar").classList.remove("open");
  if(p==="home")loadDashboard();
  if(p==="profile")loadProfileForm();
  if(p==="wordsettings")loadDocumentTemplateSettings();
  if(p==="plans")loadPlans();
  if(p==="activities")loadActivities();
  if(p==="competition"){bindScorePreview();loadScores();}
  if(["assembly","radio","assistant"].includes(p)){await ensureAIContext();loadAIHistory(p);}
  if(p==="history")loadFullHistory();
}

function render(p){
  if(p==="home")return `<div class="hero"><h1>Xin chào! 👋</h1><p>Hệ thống hỗ trợ quản lý Công tác Đội theo vòng đời: kế hoạch → tổ chức → AI → minh chứng → kết quả → hồ sơ.</p><div class="hero-actions"><button class="btn primary" data-page="assembly">✨ Soạn sinh hoạt dưới cờ</button><button class="btn secondary" data-page="radio">🎙️ Viết phát thanh</button><button class="btn secondary" data-page="assistant">🤖 Hỏi Trợ lý</button></div></div><div id="dashboardStats" class="dashboard-stats"><div class="dash-stat"><small>Đang tải dữ liệu...</small><b>—</b></div></div><div class="dashboard-columns"><div class="card"><div class="section-title"><h3>⚡ Truy cập nhanh</h3></div><div class="grid">${["profile","wordsettings","plans","activities","competition","assembly","radio","assistant","history"].map(k=>`<div class="quick" data-page="${k}"><div class="emoji">${pages[k][1]}</div><b>${pages[k][0]}</b><small>${quickDesc(k)}</small></div>`).join("")}</div></div><div class="card"><div class="section-title"><h3>🕘 AI gần đây</h3><button class="btn small secondary" data-page="history">Xem tất cả</button></div><div id="homeHistory" class="list"><div class="muted">Đang tải...</div></div></div></div>`;
  if(p==="profile")return `<div class="profile-hint">🏫 <b>Hồ sơ Liên đội là cấu hình trung tâm của ứng dụng.</b> Mỗi trường chỉ cần nhập một lần. AI, Word và các mô-đun nghiệp vụ sẽ tự lấy thông tin từ đây.</div>
<div class="card">
  <div class="section-title"><h3>Hồ sơ Liên đội • Multi-school</h3><span id="profileState" class="save-state"></span></div>

  <div class="profile-section-title">1. Thông tin đơn vị</div>
  <div class="form-grid">
    <div><label>Tên trường</label><input id="pfSchool" placeholder="Ví dụ: Trường Tiểu học ABC"></div>
    <div><label>Tên Liên đội</label><input id="pfLienDoi" placeholder="Ví dụ: Liên đội Trường Tiểu học ABC"></div>
    <div><label>Hội đồng Đội cấp trên</label><input id="pfCouncil" placeholder="Ví dụ: Hội đồng Đội xã/phường..."></div>
    <div><label>Địa danh ghi trên văn bản</label><input id="pfLocality" placeholder="Ví dụ: Đức Hòa"></div>
    <div><label>Năm học</label><input id="pfYear" placeholder="Ví dụ: 2026-2027"></div>
    <div><label>Mã trường / mã đơn vị</label><input id="pfSchoolCode" placeholder="Không bắt buộc"></div>
    <div class="full"><label>Địa chỉ trường</label><input id="pfAddress" placeholder="Không bắt buộc"></div>
    <div><label>Email đơn vị</label><input id="pfEmail" type="email" placeholder="Không bắt buộc"></div>
    <div><label>Điện thoại đơn vị</label><input id="pfPhone" placeholder="Không bắt buộc"></div>
    <div class="full"><label>Website / Fanpage</label><input id="pfWebsite" placeholder="Không bắt buộc"></div>
  </div>

  <div class="profile-section-title">2. Người phụ trách & người duyệt</div>
  <div class="form-grid">
    <div><label>Tổng phụ trách / Người lập</label><input id="pfName" placeholder="Họ và tên; có thể để trống"></div>
    <div><label>Chức danh người lập</label><input id="pfRole" placeholder="Ví dụ: Giáo viên - Tổng phụ trách Đội"></div>
    <div><label>Hiệu trưởng / Người duyệt</label><input id="pfPrincipal" placeholder="Họ và tên; có thể để trống"></div>
    <div><label>Chức danh người duyệt</label><input id="pfPrincipalTitle" placeholder="Ví dụ: Hiệu trưởng"></div>
    <div><label>Ký hiệu đơn vị trên văn bản</label><input id="pfDocPrefix" placeholder="Ví dụ: LĐTHABC"></div>
    <div><label>Logo trường (URL ảnh)</label><input id="pfSchoolLogoUrl" placeholder="https://.../logo-truong.png" oninput="previewProfileLogos()"></div>
    <div><label>Logo Đội (URL ảnh)</label><input id="pfDoiLogoUrl" placeholder="https://.../logo-doi.png" oninput="previewProfileLogos()"></div>
    <div class="full">
      <label>Xem trước nhận diện</label>
      <div class="brand-preview">
        <div class="preview-logo-box"><img id="pfSchoolLogoPreview" alt="Logo trường"><span id="pfSchoolLogoPreviewFallback">🏫</span></div>
        <div class="preview-logo-box"><img id="pfDoiLogoPreview" alt="Logo Đội"><span id="pfDoiLogoPreviewFallback">⭐</span></div>
        <div class="preview-brand-copy">
          <small id="pfSchoolPreviewText">Tên trường</small>
          <b id="pfLienDoiPreviewText">Tên Liên đội</b>
          <span>Nhận diện sẽ tự áp dụng cho màn hình đăng nhập và sidebar.</span>
        </div>
      </div>
    </div>
  </div>

  <div class="profile-section-title">3. Quy mô & ngữ cảnh AI</div>
  <div class="form-grid">
    <div><label>Số học sinh</label><input id="pfStudents" type="number" min="0" placeholder="Ví dụ: 1400"></div>
    <div><label>Số lớp</label><input id="pfClasses" type="number" min="0" placeholder="Ví dụ: 40"></div>
    <div class="full"><label>Phong cách văn bản</label><input id="pfStyle" placeholder="Ví dụ: rõ ràng, trang trọng, phù hợp học sinh tiểu học"></div>
    <div class="full"><label>Đặc điểm đơn vị</label><textarea id="pfContext" rows="4" placeholder="Quy mô, đặc thù học sinh, cơ sở vật chất, định hướng hoạt động..."></textarea></div>
    <div class="full"><label>Ngữ cảnh AI ưu tiên</label><textarea id="pfAI" rows="5" placeholder="Ví dụ: ưu tiên hoạt động sáng tạo, chi phí thấp, an toàn, dễ triển khai..."></textarea></div>
    <div class="full action-row"><button class="btn primary" onclick="saveProfile()">💾 Lưu Hồ sơ Liên đội</button></div>
  </div>
</div>`;
  if(p==="activities")return activitiesHTML();
  if(p==="wordsettings")return `<div class="profile-hint">📝 <b>Mẫu văn bản là cấu hình riêng của từng trường.</b> Anh/chị có thể quy định ký hiệu, nơi nhận, chữ ký, căn lề và câu kết cho từng loại văn bản mà không cần sửa code.</div>
<div class="card">
  <div class="section-title"><h3>Cấu hình mẫu văn bản</h3><span id="docSettingsState" class="save-state"></span></div>
  <div class="doc-template-tabs">
    <button class="doc-tab active" data-doc-type="plan" onclick="selectDocumentTemplateType('plan',this)">Kế hoạch</button>
    <button class="doc-tab" data-doc-type="report" onclick="selectDocumentTemplateType('report',this)">Báo cáo</button>
    <button class="doc-tab" data-doc-type="program" onclick="selectDocumentTemplateType('program',this)">Chương trình</button>
    <button class="doc-tab" data-doc-type="dossier" onclick="selectDocumentTemplateType('dossier',this)">Hồ sơ</button>
    <button class="doc-tab" data-doc-type="script" onclick="selectDocumentTemplateType('script',this)">Kịch bản</button>
  </div>
  <div class="profile-section-title">1. Nhận diện loại văn bản</div>
  <div class="form-grid">
    <div><label>Tên loại văn bản</label><input id="dtLabel"></div>
    <div><label>Ký hiệu văn bản</label><input id="dtCode" placeholder="Ví dụ: KH-LĐ"></div>
    <div><label>Tiêu đề mặc định</label><input id="dtTitle" placeholder="Ví dụ: KẾ HOẠCH"></div>
    <div><label>Cách ghi ngày tháng</label><select id="dtDateStyle"><option value="blank">Để trống ngày, tháng, năm khi xuất</option><option value="activity">Ưu tiên ngày hoạt động</option><option value="current">Ngày hiện tại</option></select></div>
  </div>
  <div class="profile-section-title">2. Nơi nhận & khu vực ký</div>
  <div class="form-grid">
    <div class="full"><label>Nơi nhận (mỗi dòng một nơi)</label><textarea id="dtRecipients" rows="5" placeholder="HĐĐ xã/phường...&#10;Ban Giám hiệu&#10;Lưu: Liên đội"></textarea></div>
    <div><label><input id="dtApprovalEnabled" type="checkbox"> Có cột DUYỆT CỦA BGH</label></div>
    <div><label>Tiêu đề cột duyệt</label><input id="dtApprovalTitle" placeholder="DUYỆT CỦA BGH"></div>
    <div><label>Chức danh người duyệt</label><input id="dtApprovalRole" placeholder="Hiệu trưởng"></div>
    <div><label>Tiêu đề cột người lập/ký</label><input id="dtSignerTitle" placeholder="NGƯỜI LẬP KẾ HOẠCH"></div>
    <div><label>Chức danh người lập/ký</label><input id="dtSignerRole" placeholder="GV - TPT"></div>
    <div class="full"><label>Câu kết cuối văn bản</label><textarea id="dtClosing" rows="3" placeholder="Trên đây là..."></textarea></div>
  </div>
  <div class="profile-section-title">3. Khổ giấy & căn lề Word</div>
  <div class="form-grid compact-grid">
    <div><label>Lề trên (cm)</label><input id="dtTop" type="number" min="0.5" max="5" step="0.1"></div>
    <div><label>Lề dưới (cm)</label><input id="dtBottom" type="number" min="0.5" max="5" step="0.1"></div>
    <div><label>Lề trái (cm)</label><input id="dtLeft" type="number" min="0.5" max="5" step="0.1"></div>
    <div><label>Lề phải (cm)</label><input id="dtRight" type="number" min="0.5" max="5" step="0.1"></div>
    <div><label>Cỡ chữ thân bài</label><input id="dtFontSize" type="number" min="11" max="15" step="0.5"></div>
    <div><label>Giãn dòng</label><select id="dtLineSpacing"><option value="1.0">1.0</option><option value="1.15">1.15</option><option value="1.2">1.2</option><option value="1.3">1.3</option><option value="1.5">1.5</option></select></div>
  </div>
  <div class="doc-preview-note">💡 Khi xuất Word, người dùng được chọn mẫu, xem trước cấu trúc và bật/tắt chuẩn hóa nội dung theo loại văn bản.</div>
  <div class="doc-settings-actions">
    <button class="btn secondary" onclick="resetDocumentTemplateDefaults()">↺ Khôi phục mặc định loại này</button>
    <button class="btn primary" onclick="saveDocumentTemplateSettings()">💾 Lưu mẫu văn bản</button>
  </div>
</div>`;
  if(p==="plans")return `<div class="toolbar"><input id="planTitle" placeholder="Tên kế hoạch"><input id="planDate" type="date"><select id="planStatus"><option>Chưa thực hiện</option><option>Đang thực hiện</option><option>Hoàn thành</option></select><button class="btn primary" onclick="addPlan()">＋ Lưu kế hoạch</button></div><div id="planList" class="card list">Đang tải...</div>`;
  if(p==="competition")return competitionHTML();
  if(p==="assembly")return aiModuleHTML("assembly");
  if(p==="radio")return aiModuleHTML("radio");
  if(p==="assistant")return assistantHTML();
  if(p==="history")return `<div class="history-toolbar"><input id="historySearch" placeholder="🔎 Tìm theo chủ đề, yêu cầu hoặc nội dung..." oninput="filterHistory()"><select id="historyModule" onchange="filterHistory()"><option value="all">Tất cả mô-đun</option><option value="assembly">Sinh hoạt dưới cờ</option><option value="radio">Phát thanh măng non</option><option value="assistant">Trợ lý Công tác Đội</option></select><select id="historyLimit" onchange="loadFullHistory()"><option value="20">20 nội dung</option><option value="50">50 nội dung</option><option value="100">100 nội dung</option></select></div><div id="historyList" class="history-list"><div class="card">Đang tải...</div></div>`;
  return "";
}

const BRANDING_STORAGE_KEY="doi_ai_school_branding_v1";

function normalizeBrandingProfile(p={}){
  return {
    school_name:String(p.school_name||"").trim(),
    lien_doi_name:String(p.lien_doi_name||"").trim(),
    school_logo_url:String(p.school_logo_url||p.logo_url||"").trim(),
    doi_logo_url:String(p.doi_logo_url||"").trim()
  };
}
function persistBranding(p){
  try{localStorage.setItem(BRANDING_STORAGE_KEY,JSON.stringify(normalizeBrandingProfile(p||{})));}catch(e){}
}
function loadLocalBranding(){
  try{return JSON.parse(localStorage.getItem(BRANDING_STORAGE_KEY)||"{}")||{};}catch(e){return{};}
}
function setBrandImage(imgId,fallbackId,url){
  const img=$("#"+imgId),fb=$("#"+fallbackId);
  if(!img||!fb)return;
  img.onload=()=>{img.classList.add("visible");fb.classList.add("hidden");};
  img.onerror=()=>{img.removeAttribute("src");img.classList.remove("visible");fb.classList.remove("hidden");};
  if(url){img.src=url;}else{img.removeAttribute("src");img.classList.remove("visible");fb.classList.remove("hidden");}
}
function applyBranding(profile){
  const p=normalizeBrandingProfile(profile||{});
  const school=p.school_name||"CÔNG TÁC ĐỘI AI";
  const lienDoi=p.lien_doi_name||"Công tác Đội AI";

  if($("#loginSchoolName"))$("#loginSchoolName").textContent=school.toUpperCase();
  if($("#loginLienDoiName"))$("#loginLienDoiName").textContent=lienDoi;
  if($("#loginSubtitle"))$("#loginSubtitle").textContent=p.school_name?"Trợ lý số Công tác Đội của đơn vị":"Trợ lý số dành cho Tổng phụ trách Đội";

  if($("#sideSchoolName"))$("#sideSchoolName").textContent=school.toUpperCase();
  if($("#sideLienDoiName"))$("#sideLienDoiName").textContent=lienDoi;

  setBrandImage("loginSchoolLogo","loginSchoolLogoFallback",p.school_logo_url);
  setBrandImage("loginDoiLogo","loginDoiLogoFallback",p.doi_logo_url);
  setBrandImage("sideSchoolLogo","sideSchoolLogoFallback",p.school_logo_url);
  setBrandImage("sideDoiLogo","sideDoiLogoFallback",p.doi_logo_url);

  document.title=(p.school_name?`${p.school_name} • `:"")+"Công tác Đội AI";
}
function previewImage(imgId,fallbackId,url){
  setBrandImage(imgId,fallbackId,url);
}
function previewProfileLogos(){
  const school=$("#pfSchool")?.value?.trim()||cachedProfile?.school_name||"Tên trường";
  const lienDoi=$("#pfLienDoi")?.value?.trim()||cachedProfile?.lien_doi_name||"Tên Liên đội";
  if($("#pfSchoolPreviewText"))$("#pfSchoolPreviewText").textContent=school;
  if($("#pfLienDoiPreviewText"))$("#pfLienDoiPreviewText").textContent=lienDoi;
  previewImage("pfSchoolLogoPreview","pfSchoolLogoPreviewFallback",$("#pfSchoolLogoUrl")?.value?.trim()||"");
  previewImage("pfDoiLogoPreview","pfDoiLogoPreviewFallback",$("#pfDoiLogoUrl")?.value?.trim()||"");
}
document.addEventListener("input",e=>{
  if(["pfSchool","pfLienDoi"].includes(e.target?.id))previewProfileLogos();
});

function quickDesc(k){return {profile:"Cấu hình ngữ cảnh trường",wordsettings:"Cấu hình Word theo từng trường",plans:"Theo dõi kế hoạch",activities:"Quản lý vòng đời hoạt động",competition:"Nhập điểm và xếp hạng",assembly:"Kịch bản dùng ngay",radio:"Bản tin 3–7 phút",assistant:"9 nhóm tác vụ nghiệp vụ",history:"Tìm lại nội dung đã tạo"}[k]||"";}

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
    const [p,a,s,h,pr]=await Promise.all([
      sb.from("plans").select("id",{count:"exact",head:true}),
      sb.from("team_activities").select("id",{count:"exact",head:true}),
      sb.from("competition_scores").select("id",{count:"exact",head:true}),
      sb.from("ai_history").select("id",{count:"exact",head:true}),
      sb.from("lien_doi_profile").select("id",{count:"exact",head:true}).eq("user_id",currentUser.id)
    ]);
    stats.innerHTML=`<div class="dash-stat"><small>Kế hoạch</small><b>${p.count??0}</b></div><div class="dash-stat"><small>Hoạt động</small><b>${a.count??0}</b></div><div class="dash-stat"><small>Bản ghi thi đua</small><b>${s.count??0}</b></div><div class="dash-stat"><small>Nội dung AI đã lưu</small><b>${h.count??0}</b></div><div class="dash-stat"><small>Hồ sơ Liên đội</small><b>${(pr.count??0)>0?"✓":"!"}</b></div>`;
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


const DOCUMENT_TEMPLATE_DEFAULTS={
  plan:{document_type:"plan",label:"Kế hoạch",code_prefix:"KH-LĐ",default_title:"KẾ HOẠCH",date_style:"blank",recipients:"Hội đồng Đội cấp trên\nBan Giám hiệu\nLưu: Liên đội",approval_enabled:true,approval_title:"DUYỆT CỦA BGH",approval_role:"Hiệu trưởng",signer_title:"NGƯỜI LẬP KẾ HOẠCH",signer_role:"GV - TPT",closing_sentence:"Trên đây là kế hoạch tổ chức hoạt động của Liên đội.",margin_top:2,margin_bottom:2,margin_left:3,margin_right:2,font_size:13,line_spacing:1.15},
  report:{document_type:"report",label:"Báo cáo",code_prefix:"BC-LĐ",default_title:"BÁO CÁO",date_style:"blank",recipients:"Hội đồng Đội cấp trên\nBan Giám hiệu\nLưu: Liên đội",approval_enabled:true,approval_title:"DUYỆT CỦA BGH",approval_role:"Hiệu trưởng",signer_title:"NGƯỜI LẬP BÁO CÁO",signer_role:"GV - TPT",closing_sentence:"Trên đây là báo cáo kết quả thực hiện hoạt động của Liên đội.",margin_top:2,margin_bottom:1.5,margin_left:2,margin_right:2,font_size:13,line_spacing:1.15},
  program:{document_type:"program",label:"Chương trình",code_prefix:"CTr-LĐ",default_title:"CHƯƠNG TRÌNH",date_style:"blank",recipients:"Hội đồng Đội cấp trên\nBan Giám hiệu\nCác chi đội, lớp nhi đồng\nLưu: Liên đội",approval_enabled:true,approval_title:"DUYỆT CỦA BGH",approval_role:"Hiệu trưởng",signer_title:"TM. LIÊN ĐỘI",signer_role:"GV - TPT",closing_sentence:"Trên đây là chương trình công tác của Liên đội.",margin_top:2,margin_bottom:2,margin_left:3,margin_right:2,font_size:13,line_spacing:1.15},
  dossier:{document_type:"dossier",label:"Hồ sơ",code_prefix:"HS-LĐ",default_title:"HỒ SƠ HOẠT ĐỘNG",date_style:"blank",recipients:"Ban Giám hiệu\nLưu: Liên đội",approval_enabled:true,approval_title:"DUYỆT CỦA BGH",approval_role:"Hiệu trưởng",signer_title:"NGƯỜI LẬP HỒ SƠ",signer_role:"GV - TPT",closing_sentence:"Trên đây là hồ sơ hoạt động Công tác Đội của Liên đội.",margin_top:2,margin_bottom:1.5,margin_left:3,margin_right:2,font_size:13,line_spacing:1.15},
  script:{document_type:"script",label:"Kịch bản",code_prefix:"KB-LĐ",default_title:"KỊCH BẢN",date_style:"blank",recipients:"Lưu: Liên đội",approval_enabled:false,approval_title:"DUYỆT CỦA BGH",approval_role:"Hiệu trưởng",signer_title:"NGƯỜI XÂY DỰNG KỊCH BẢN",signer_role:"GV - TPT",closing_sentence:"",margin_top:2,margin_bottom:2,margin_left:2.5,margin_right:2,font_size:13,line_spacing:1.15}
};

const DOCUMENT_STRUCTURE_SCHEMAS={
  plan:{
    label:"Kế hoạch",
    sections:[
      {title:"I. MỤC ĐÍCH",keys:["mục đích","muc dich","ý nghĩa","y nghia"]},
      {title:"II. YÊU CẦU",keys:["yêu cầu","yeu cau"]},
      {title:"III. NỘI DUNG THỰC HIỆN",keys:["nội dung","noi dung","hoạt động","hoat dong","cách thực hiện","cach thuc hien"]},
      {title:"IV. THỜI GIAN - ĐỊA ĐIỂM - THÀNH PHẦN",keys:["thời gian","thoi gian","địa điểm","dia diem","thành phần","thanh phan","đối tượng","doi tuong"]},
      {title:"V. TỔ CHỨC THỰC HIỆN",keys:["tổ chức thực hiện","to chuc thuc hien","phân công","phan cong","phối hợp","phoi hop"]},
      {title:"VI. KINH PHÍ VÀ ĐIỀU KIỆN BẢO ĐẢM",keys:["kinh phí","kinh phi","điều kiện","dieu kien","chuẩn bị","chuan bi"]}
    ]
  },
  report:{
    label:"Báo cáo",
    sections:[
      {title:"I. KHÁI QUÁT HOẠT ĐỘNG",keys:["khái quát","khai quat","mục đích","muc dich","thời gian","thoi gian","địa điểm","dia diem","thành phần","thanh phan"]},
      {title:"II. KẾT QUẢ THỰC HIỆN",keys:["kết quả","ket qua","đạt được","dat duoc","nổi bật","noi bat","highlights"]},
      {title:"III. HẠN CHẾ",keys:["hạn chế","han che","tồn tại","ton tai","khó khăn","kho khan"]},
      {title:"IV. NGUYÊN NHÂN",keys:["nguyên nhân","nguyen nhan","causes"]},
      {title:"V. BÀI HỌC KINH NGHIỆM",keys:["bài học","bai hoc","kinh nghiệm","kinh nghiem","lessons"]},
      {title:"VI. KIẾN NGHỊ - ĐỀ XUẤT",keys:["kiến nghị","kien nghi","đề xuất","de xuat","recommendations"]}
    ]
  },
  program:{
    label:"Chương trình",
    sections:[
      {title:"I. MỤC ĐÍCH - YÊU CẦU",keys:["mục đích","muc dich","yêu cầu","yeu cau"]},
      {title:"II. NỘI DUNG CHƯƠNG TRÌNH",keys:["nội dung","noi dung","chương trình","chuong trinh"]},
      {title:"III. TIẾN ĐỘ - THỜI GIAN THỰC HIỆN",keys:["tiến độ","tien do","thời gian","thoi gian"]},
      {title:"IV. PHÂN CÔNG THỰC HIỆN",keys:["phân công","phan cong","tổ chức thực hiện","to chuc thuc hien"]},
      {title:"V. TỔ CHỨC PHỐI HỢP",keys:["phối hợp","phoi hop","đơn vị phối hợp","don vi phoi hop"]}
    ]
  },
  dossier:{
    label:"Hồ sơ",
    sections:[
      {title:"I. THÔNG TIN HOẠT ĐỘNG",keys:["thông tin hoạt động","thong tin hoat dong","thời gian","thoi gian","địa điểm","dia diem"]},
      {title:"II. MỤC TIÊU - NỘI DUNG - YÊU CẦU",keys:["mục tiêu","muc tieu","mục đích","muc dich","nội dung","noi dung","yêu cầu","yeu cau"]},
      {title:"III. SẢN PHẨM AI ĐÃ TẠO",keys:["sản phẩm ai","san pham ai","ai đã tạo","ai da tao"]},
      {title:"IV. MINH CHỨNG",keys:["minh chứng","minh chung","evidence"]},
      {title:"V. KẾT QUẢ THỰC HIỆN",keys:["kết quả","ket qua","results"]},
      {title:"VI. THÔNG TIN ĐƠN VỊ",keys:["hồ sơ liên đội","ho so lien doi","thông tin đơn vị","thong tin don vi"]}
    ]
  },
  script:{
    label:"Kịch bản",
    sections:[
      {title:"I. THÔNG TIN CHUNG",keys:["thông tin chung","thong tin chung","chủ đề","chu de","mục tiêu","muc tieu"]},
      {title:"II. BẢNG KỊCH BẢN CHI TIẾT",keys:["kịch bản","kich ban","lời dẫn","loi dan","mc","timeline","thời lượng","thoi luong"]},
      {title:"III. PHÂN CÔNG NGƯỜI PHỤ TRÁCH",keys:["người phụ trách","nguoi phu trach","phân công","phan cong"]},
      {title:"IV. CHUẨN BỊ - KỸ THUẬT",keys:["chuẩn bị","chuan bi","kỹ thuật","ky thuat","âm thanh","am thanh","đạo cụ","dao cu"]}
    ]
  }
};
let selectedDocumentTemplateType="plan";
let pendingWordExportType="auto";
function mergedDocumentTemplate(type){
  const d=DOCUMENT_TEMPLATE_DEFAULTS[type]||DOCUMENT_TEMPLATE_DEFAULTS.dossier;
  const saved=documentTemplateCache.find(x=>x.document_type===type)||{};
  return {...d,...saved};
}
async function loadDocumentTemplateCache(force=false){
  if(demo||!sb)return [];
  if(documentTemplateCache.length&&!force)return documentTemplateCache;
  const {data,error}=await sb.from("document_templates").select("*").eq("user_id",currentUser.id).order("document_type");
  if(error){console.warn("document_templates:",error.message);documentTemplateCache=[];return [];}
  documentTemplateCache=data||[];
  return documentTemplateCache;
}
async function loadDocumentTemplateSettings(){
  if(demo){$("#docSettingsState").textContent="Demo: chưa lưu lên Supabase";fillDocumentTemplateForm(mergedDocumentTemplate(selectedDocumentTemplateType));return;}
  await loadDocumentTemplateCache(true);
  selectDocumentTemplateType(selectedDocumentTemplateType,document.querySelector(`[data-doc-type="${selectedDocumentTemplateType}"]`));
  $("#docSettingsState").textContent="✓ Đã tải cấu hình mẫu văn bản.";
}
function selectDocumentTemplateType(type,btn=null){
  selectedDocumentTemplateType=type;
  document.querySelectorAll(".doc-tab").forEach(x=>x.classList.toggle("active",x.dataset.docType===type));
  fillDocumentTemplateForm(mergedDocumentTemplate(type));
  if($("#docSettingsState"))$("#docSettingsState").textContent=documentTemplateCache.some(x=>x.document_type===type)?"✓ Đã có cấu hình riêng":"Đang dùng cấu hình mặc định";
}
function fillDocumentTemplateForm(t){
  const vals={dtLabel:t.label,dtCode:t.code_prefix,dtTitle:t.default_title,dtDateStyle:t.date_style,dtRecipients:t.recipients,dtApprovalTitle:t.approval_title,dtApprovalRole:t.approval_role,dtSignerTitle:t.signer_title,dtSignerRole:t.signer_role,dtClosing:t.closing_sentence,dtTop:t.margin_top,dtBottom:t.margin_bottom,dtLeft:t.margin_left,dtRight:t.margin_right,dtFontSize:t.font_size,dtLineSpacing:String(t.line_spacing)};
  Object.entries(vals).forEach(([id,v])=>{const el=$("#"+id);if(el)el.value=v??"";});
  if($("#dtApprovalEnabled"))$("#dtApprovalEnabled").checked=!!t.approval_enabled;
}
function readDocumentTemplateForm(){
  return {document_type:selectedDocumentTemplateType,label:$("#dtLabel").value.trim()||DOCUMENT_TEMPLATE_DEFAULTS[selectedDocumentTemplateType].label,code_prefix:$("#dtCode").value.trim(),default_title:$("#dtTitle").value.trim(),date_style:$("#dtDateStyle").value,recipients:$("#dtRecipients").value.trim(),approval_enabled:$("#dtApprovalEnabled").checked,approval_title:$("#dtApprovalTitle").value.trim(),approval_role:$("#dtApprovalRole").value.trim(),signer_title:$("#dtSignerTitle").value.trim(),signer_role:$("#dtSignerRole").value.trim(),closing_sentence:$("#dtClosing").value.trim(),margin_top:Number($("#dtTop").value)||2,margin_bottom:Number($("#dtBottom").value)||2,margin_left:Number($("#dtLeft").value)||3,margin_right:Number($("#dtRight").value)||2,font_size:Number($("#dtFontSize").value)||13,line_spacing:Number($("#dtLineSpacing").value)||1.15};
}
async function saveDocumentTemplateSettings(){
  if(demo)return alert("Chế độ Demo chưa thể lưu mẫu văn bản.");
  const row={...readDocumentTemplateForm(),user_id:currentUser.id,updated_at:new Date().toISOString()};
  const {data,error}=await sb.from("document_templates").upsert(row,{onConflict:"user_id,document_type"}).select().single();
  if(error)return alert("Chưa lưu được mẫu văn bản: "+error.message);
  documentTemplateCache=documentTemplateCache.filter(x=>x.document_type!==row.document_type).concat(data);
  $("#docSettingsState").textContent="✓ Đã lưu";
  toast("Đã lưu cấu hình mẫu "+data.label+".");
}
function resetDocumentTemplateDefaults(){
  const type=selectedDocumentTemplateType;
  fillDocumentTemplateForm(DOCUMENT_TEMPLATE_DEFAULTS[type]);
  $("#docSettingsState").textContent="Đã khôi phục mặc định trên biểu mẫu — bấm Lưu để áp dụng.";
}
function cmToTwips(cm){return Math.round(Number(cm||0)*567);}
function lineSpacingToTwips(v){return Math.round(Number(v||1.15)*240);}

async function loadProfileForm(){
  if(demo){$("#profileState").textContent="Demo: chưa lưu lên Supabase";return;}
  const p=await loadProfileCache(true);
  if(!p){$("#profileState").textContent="Chưa có hồ sơ — hãy nhập và lưu lần đầu.";return;}
  const map={
    pfSchool:p.school_name,
    pfLienDoi:p.lien_doi_name,
    pfCouncil:p.council_name,
    pfLocality:p.locality,
    pfYear:p.school_year,
    pfSchoolCode:p.school_code,
    pfAddress:p.school_address,
    pfEmail:p.school_email,
    pfPhone:p.school_phone,
    pfWebsite:p.school_website,
    pfName:p.tong_phu_trach_name,
    pfRole:p.role_name,
    pfPrincipal:p.principal_name,
    pfPrincipalTitle:p.principal_title,
    pfDocPrefix:p.document_prefix,
    pfSchoolLogoUrl:p.school_logo_url||p.logo_url,
    pfDoiLogoUrl:p.doi_logo_url,
    pfStudents:p.student_count,
    pfClasses:p.class_count,
    pfStyle:p.writing_style,
    pfContext:p.school_context,
    pfAI:p.ai_context
  };
  Object.entries(map).forEach(([id,v])=>{
    if($("#"+id)&&v!==null&&v!==undefined)$("#"+id).value=v;
  });
  $("#profileState").textContent="✓ Đã tải cấu hình đơn vị.";
  previewProfileLogos();
}

async function saveProfile(){
  if(demo)return alert("Chế độ Demo chưa thể lưu Hồ sơ Liên đội lên Supabase.");
  const row={
    user_id:currentUser.id,
    school_name:$("#pfSchool").value.trim(),
    lien_doi_name:$("#pfLienDoi").value.trim(),
    council_name:$("#pfCouncil").value.trim(),
    locality:$("#pfLocality").value.trim(),
    school_year:$("#pfYear").value.trim(),
    school_code:$("#pfSchoolCode").value.trim(),
    school_address:$("#pfAddress").value.trim(),
    school_email:$("#pfEmail").value.trim(),
    school_phone:$("#pfPhone").value.trim(),
    school_website:$("#pfWebsite").value.trim(),
    tong_phu_trach_name:$("#pfName").value.trim(),
    role_name:$("#pfRole").value.trim(),
    principal_name:$("#pfPrincipal").value.trim(),
    principal_title:$("#pfPrincipalTitle").value.trim(),
    document_prefix:$("#pfDocPrefix").value.trim(),
    school_logo_url:$("#pfSchoolLogoUrl").value.trim(),
    doi_logo_url:$("#pfDoiLogoUrl").value.trim(),
    logo_url:$("#pfSchoolLogoUrl").value.trim(),
    student_count:Number($("#pfStudents").value)||null,
    class_count:Number($("#pfClasses").value)||null,
    school_context:$("#pfContext").value.trim(),
    writing_style:$("#pfStyle").value.trim(),
    ai_context:$("#pfAI").value.trim(),
    updated_at:new Date().toISOString()
  };
  if(!row.school_name)return alert("Anh/chị nhập Tên trường trước.");
  if(!row.lien_doi_name)row.lien_doi_name="Liên đội "+row.school_name;

  const {data,error}=await sb.from("lien_doi_profile")
    .upsert(row,{onConflict:"user_id"}).select().single();

  if(error)return alert("Chưa lưu được Hồ sơ Liên đội: "+error.message);
  cachedProfile=data;
  persistBranding(data);
  applyBranding(data);
  previewProfileLogos();
  $("#profileState").textContent="✓ Đã lưu";
  toast("Đã lưu cấu hình và cập nhật nhận diện trường.");
}

function profileForAI(){
  const p=cachedProfile||{};
  return {
    school_name:p.school_name||"",
    lien_doi_name:p.lien_doi_name||"",
    council_name:p.council_name||"",
    locality:p.locality||"",
    school_year:p.school_year||"",
    school_code:p.school_code||"",
    school_address:p.school_address||"",
    school_email:p.school_email||"",
    school_phone:p.school_phone||"",
    school_website:p.school_website||"",
    tong_phu_trach_name:p.tong_phu_trach_name||"",
    role_name:p.role_name||"Tổng phụ trách Đội",
    principal_name:p.principal_name||"",
    principal_title:p.principal_title||"Hiệu trưởng",
    document_prefix:p.document_prefix||"",
    school_logo_url:p.school_logo_url||p.logo_url||"",
    doi_logo_url:p.doi_logo_url||"",
    student_count:p.student_count||null,
    class_count:p.class_count||null,
    school_context:p.school_context||"",
    writing_style:p.writing_style||"Tiếng Việt rõ ràng, phù hợp môi trường giáo dục",
    ai_context:p.ai_context||""
  };
}

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
    const text=data?.text||"";if(!text)throw new Error("AI chưa trả về nội dung.");if(out)out.textContent=text;status.textContent=`✓ Đã tạo bằng ${data.model||"OpenAI"}.`;
    const history=historyRow(module,body,text);const {error:historyError}=await sb.from("ai_history").insert(history);
    if(historyError)status.textContent += " Chưa lưu lịch sử: "+historyError.message;else{loadAIHistory(module);toast("Đã tạo và lưu vào Lịch sử AI.");}
  }catch(e){if(out)out.textContent="Chưa tạo được nội dung.";if(status)status.textContent="Lỗi: "+(e?.message||e);}
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
  const limit=Number($("#historyLimit")?.value||20);const {data,error}=await sb.from("ai_history").select("id,module,title,topic,prompt,result,duration,audience,extra,created_at").order("created_at",{ascending:false}).limit(limit);if(error){box.innerHTML=`<div class="card">${esc(error.message)}</div>`;return;}historyCache=data||[];renderActivityDocumentCards();filterHistory();
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


// =====================================================
// V1.5A - HOẠT ĐỘNG & SỰ KIỆN
// =====================================================
const activityStatusLabels={planned:"Dự kiến",planned_ready:"Đã lên kế hoạch",preparing:"Đang chuẩn bị",in_progress:"Đang thực hiện",completed:"Đã thực hiện",archived:"Hoàn thành hồ sơ",cancelled:"Đã hủy"};
const activityStatusIcons={planned:"⚪",planned_ready:"🔵",preparing:"🟡",in_progress:"🟠",completed:"🟢",archived:"✅",cancelled:"🔴"};
const activityTypes=["Giáo dục truyền thống","Đạo đức lối sống","Sinh hoạt dưới cờ","Văn hóa đọc","Kỹ năng sống","An toàn giao thông","Phòng chống đuối nước","Môi trường","Chuyển đổi số & AI","Sức khỏe học đường","Trung thu","20/11","Hoạt động trải nghiệm","Văn nghệ","Thể thao","Thi đua","Từ thiện","Công trình măng non","Khác"];
const activityAITasks={script:["Kịch bản chương trình","Soạn kịch bản chương trình chi tiết theo trình tự, thời lượng, nội dung, người phụ trách và yêu cầu kỹ thuật; không viết dính thành một hồ sơ tổng hợp."],plan:["Kế hoạch hoạt động","Soạn kế hoạch tổ chức hoàn chỉnh, rõ mục đích, yêu cầu, nội dung, tiến độ, phân công, nguồn lực, dự kiến rủi ro và tổ chức thực hiện."],mc:["Lời dẫn MC","Chỉ soạn lời dẫn MC độc lập, tự nhiên, dễ đọc trực tiếp; không lặp lại toàn bộ kế hoạch hay kịch bản chương trình."],radio:["Phát thanh măng non","Soạn bản phát thanh măng non gắn với hoạt động, ngắn gọn, gần gũi, có thông điệp giáo dục và lời kết."],fanpage:["Tin bài Fanpage","Viết tin bài Fanpage trường học theo phong cách tin giáo dục, nêu đúng thông tin hoạt động, kết quả và thông điệp tích cực."],game:["Trò chơi / tương tác","Đề xuất trò chơi hoặc hoạt động tương tác phù hợp quy mô, độ tuổi, mục tiêu, thời lượng và điều kiện trường học."],quiz:["Câu hỏi giao lưu","Tạo bộ câu hỏi giao lưu có đáp án, mức độ phù hợp học sinh tiểu học, dễ tổ chức trước đông học sinh."],evidence:["Danh mục minh chứng","Đề xuất danh mục minh chứng cần chuẩn bị trước, trong và sau hoạt động; chia theo nhóm văn bản, hình ảnh, sản phẩm, truyền thông và kết quả."],report:["Báo cáo kết quả","Soạn khung báo cáo kết quả hoạt động, có kết quả, số liệu cần bổ sung, ưu điểm, hạn chế, bài học kinh nghiệm và kiến nghị."]};
function activityTypeOptions(){return activityTypes.map(x=>`<option>${esc(x)}</option>`).join("");}
function activityStatusOptions(){return Object.entries(activityStatusLabels).map(([k,v])=>`<option value="${k}">${activityStatusIcons[k]} ${v}</option>`).join("");}
function activitiesHTML(){return `<div class="activity-top"><div><h3>🎯 Hoạt động & Sự kiện</h3><div class="muted">Tạo nhanh hoặc tạo trực tiếp từ công văn cấp trên. AI tự đọc nguồn và soạn Kế hoạch trường.</div></div><div class="activity-top-actions"><button class="btn secondary" onclick="openSourceWorkflowModal()">📎 Tạo từ công văn</button><button class="btn primary" onclick="newActivity()">⚡ Tạo nhanh</button></div></div>
<div id="activityStats" class="activity-stats"></div>
<div class="card activity-filter"><div class="field"><label>Năm học</label><input id="afYear" value="2026-2027" oninput="filterActivities()"></div><div class="field"><label>Tháng</label><select id="afMonth" onchange="filterActivities()"><option value="all">Tất cả</option>${Array.from({length:12},(_,i)=>`<option value="${i+1}">Tháng ${i+1}</option>`).join("")}</select></div><div class="field"><label>Loại hoạt động</label><select id="afType" onchange="filterActivities()"><option value="all">Tất cả loại</option>${activityTypeOptions()}</select></div><div class="field"><label>Trạng thái</label><select id="afStatus" onchange="filterActivities()"><option value="all">Tất cả trạng thái</option>${activityStatusOptions()}</select></div><div class="field grow"><label>Tìm kiếm</label><input id="afSearch" placeholder="Tên hoạt động, chủ đề, địa điểm..." oninput="filterActivities()"></div></div>
<div class="activity-layout"><div><div id="activityFormCard" class="card activity-form-card hidden">${activityFormHTML()}</div><div id="activityList" class="activity-list"><div class="card">Đang tải...</div></div></div><div id="activityDetail" class="card activity-detail"><div class="empty">Chọn một hoạt động để xem hồ sơ và dùng AI hỗ trợ.</div></div></div>`;}
function activityFormHTML(){return `<div class="section-title"><h3 id="activityFormTitle">Tạo hoạt động mới</h3><button class="btn small secondary" onclick="closeActivityForm()">Đóng</button></div><div class="form-grid"><div><label>Tên hoạt động *</label><input id="acName" placeholder="Ví dụ: Ngày hội Thiếu nhi vui khỏe"></div><div><label>Loại hoạt động</label><select id="acType">${activityTypeOptions()}</select></div><div><label>Chủ đề</label><input id="acTheme" placeholder="Ví dụ: Tiến bước lên Đoàn"></div><div><label>Năm học</label><input id="acYear" value="2026-2027"></div><div><label>Ngày bắt đầu</label><input id="acStart" type="date"></div><div><label>Ngày kết thúc</label><input id="acEnd" type="date"></div><div><label>Giờ bắt đầu</label><input id="acTime" type="time"></div><div><label>Địa điểm</label><input id="acLocation" placeholder="Sân trường, hội trường..."></div><div><label>Đối tượng</label><input id="acAudience" placeholder="Toàn trường, khối 4–5..."></div><div><label>Số người dự kiến</label><input id="acCount" type="number" min="0"></div><div><label>Người phụ trách</label><input id="acOwner" placeholder="Tổng phụ trách Đội"></div><div><label>Lực lượng phối hợp</label><input id="acPartners" placeholder="GVCN, Chi đoàn, CMHS..."></div><div><label>Hình thức tổ chức</label><input id="acFormat" placeholder="Sân khấu + giao lưu + trò chơi"></div><div><label>Trạng thái</label><select id="acStatus">${activityStatusOptions()}</select></div><div><label>Kinh phí dự kiến (đồng)</label><input id="acBudget" type="number" min="0" step="1000" value="0"></div><div class="full"><label>Mục tiêu</label><textarea id="acObjectives" rows="3"></textarea></div><div class="full"><label>Nội dung chính</label><textarea id="acContent" rows="4"></textarea></div><div class="full"><label>Yêu cầu / điều kiện</label><textarea id="acRequirements" rows="3"></textarea></div><div class="full"><label>Ghi chú</label><textarea id="acNotes" rows="2"></textarea></div><div class="full action-row"><button class="btn primary" onclick="saveActivity()">💾 Lưu hoạt động</button><button class="btn secondary" onclick="closeActivityForm()">Hủy</button></div></div>`;}
function newActivity(){openQuickActivityModal();return;editingActivityId=null;$("#activityFormTitle").textContent="Tạo hoạt động mới";$("#activityFormCard").classList.remove("hidden");const ids=["acName","acTheme","acStart","acEnd","acTime","acLocation","acAudience","acCount","acOwner","acPartners","acFormat","acObjectives","acContent","acRequirements","acNotes"];ids.forEach(id=>{if($("#"+id))$("#"+id).value="";});$("#acYear").value=cachedProfile?.school_year||"2026-2027";$("#acStatus").value="planned";$("#acBudget").value=0;$("#acType").selectedIndex=0;window.scrollTo({top:0,behavior:"smooth"});}
function closeActivityForm(){$("#activityFormCard")?.classList.add("hidden");editingActivityId=null;}
function activityFormRow(){return {school_year:$("#acYear").value.trim()||"2026-2027",activity_name:$("#acName").value.trim(),activity_type:$("#acType").value,theme:$("#acTheme").value.trim(),start_date:$("#acStart").value||null,end_date:$("#acEnd").value||null,start_time:$("#acTime").value||null,location:$("#acLocation").value.trim(),audience:$("#acAudience").value.trim(),participant_count:Number($("#acCount").value)||null,person_in_charge:$("#acOwner").value.trim(),coordinating_units:$("#acPartners").value.trim(),objectives:$("#acObjectives").value.trim(),main_content:$("#acContent").value.trim(),organization_form:$("#acFormat").value.trim(),requirements:$("#acRequirements").value.trim(),estimated_budget:Number($("#acBudget").value)||0,status:$("#acStatus").value,notes:$("#acNotes").value.trim(),updated_at:new Date().toISOString()};}
async function saveActivity(){if(demo)return alert("Hoạt động & Sự kiện cần kết nối Supabase.");const row=activityFormRow();if(!row.activity_name)return alert("Anh nhập tên hoạt động trước.");row.created_by=currentUser.id;const wasEditing=!!editingActivityId;let q=editingActivityId?sb.from("team_activities").update(row).eq("id",editingActivityId):sb.from("team_activities").insert(row);const {error}=await q;if(error)return alert("Chưa lưu được hoạt động: "+error.message);closeActivityForm();await loadActivities();toast(wasEditing?"Đã cập nhật hoạt động.":"Đã tạo hoạt động mới.");}
async function loadActivities(){if(demo){activityCache=[];renderActivityStats([]);renderActivityList([]);return;}const {data,error}=await sb.from("team_activities").select("*").order("start_date",{ascending:false,nullsFirst:false}).order("created_at",{ascending:false});if(error){$("#activityList").innerHTML=`<div class="card">${esc(error.message)}</div>`;return;}activityCache=data||[];renderActivityStats(activityCache);filterActivities();}
function renderActivityStats(arr){const now=new Date(), month=now.getMonth()+1, year=now.getFullYear();const upcoming=arr.filter(x=>x.start_date&&new Date(x.start_date+"T23:59:59")>=now&&!["completed","archived","cancelled"].includes(x.status)).length;const preparing=arr.filter(x=>x.status==="preparing").length,done=arr.filter(x=>["completed","archived"].includes(x.status)).length,unfinished=arr.filter(x=>x.status==="completed").length;const box=$("#activityStats");if(box)box.innerHTML=`<div class="stat"><small>Tổng hoạt động</small><b>${arr.length}</b></div><div class="stat"><small>Sắp diễn ra</small><b>${upcoming}</b></div><div class="stat"><small>Đang chuẩn bị</small><b>${preparing}</b></div><div class="stat"><small>Đã thực hiện</small><b>${done}</b></div><div class="stat"><small>Chưa hoàn thiện hồ sơ</small><b>${unfinished}</b></div>`;}
function filterActivities(){const y=$("#afYear")?.value.trim().toLowerCase()||"",m=$("#afMonth")?.value||"all",t=$("#afType")?.value||"all",st=$("#afStatus")?.value||"all",q=$("#afSearch")?.value.trim().toLowerCase()||"";let arr=activityCache.filter(x=>(!y||String(x.school_year||"").toLowerCase().includes(y))&&(m==="all"||Number(String(x.start_date||"").slice(5,7))===Number(m))&&(t==="all"||x.activity_type===t)&&(st==="all"||x.status===st)&&(!q||[x.activity_name,x.theme,x.location,x.audience,x.person_in_charge].join(" ").toLowerCase().includes(q)));renderActivityList(arr);}
function activityDateText(x){if(!x.start_date)return "Chưa đặt ngày";const d=new Date(x.start_date+"T00:00:00");let s=d.toLocaleDateString("vi-VN");if(x.start_time)s+=` • ${String(x.start_time).slice(0,5)}`;return s;}
function renderActivityList(arr){const box=$("#activityList");if(!box)return;box.innerHTML=arr.length?arr.map(x=>`<div class="activity-card ${selectedActivityId===x.id?"selected":""}" onclick="openActivity('${x.id}')"><div class="activity-card-head"><div><span class="module-badge">${esc(x.activity_type||"Hoạt động")}</span><h4>${esc(x.activity_name)}</h4></div><span class="status-chip status-${esc(x.status)}">${activityStatusIcons[x.status]||"•"} ${esc(activityStatusLabels[x.status]||x.status)}</span></div><div class="activity-meta">📅 ${esc(activityDateText(x))} &nbsp; • &nbsp; 📍 ${esc(x.location||"Chưa có địa điểm")}</div><div class="activity-meta">👥 ${esc(x.audience||"Chưa xác định đối tượng")} &nbsp; • &nbsp; 👤 ${esc(x.person_in_charge||"Chưa phân công")}</div><div class="activity-actions" onclick="event.stopPropagation()"><button class="btn small secondary" onclick="openActivity('${x.id}')">Xem hồ sơ</button><button class="btn small secondary" onclick="editActivity('${x.id}')">Sửa</button><button class="btn small soft" onclick="cloneActivity('${x.id}')">📋 Nhân bản</button><button class="btn small danger" onclick="deleteActivity('${x.id}')">Xóa</button></div></div>`).join(""):`<div class="card empty">Chưa có hoạt động phù hợp. Bấm “＋ Tạo hoạt động mới” để bắt đầu.</div>`;}
function editActivity(id){const x=activityCache.find(a=>a.id===id);if(!x)return;editingActivityId=id;$("#activityFormTitle").textContent="Chỉnh sửa hoạt động";$("#activityFormCard").classList.remove("hidden");const map={acName:x.activity_name,acType:x.activity_type,acTheme:x.theme,acYear:x.school_year,acStart:x.start_date,acEnd:x.end_date,acTime:x.start_time?String(x.start_time).slice(0,5):"",acLocation:x.location,acAudience:x.audience,acCount:x.participant_count,acOwner:x.person_in_charge,acPartners:x.coordinating_units,acObjectives:x.objectives,acContent:x.main_content,acFormat:x.organization_form,acRequirements:x.requirements,acBudget:x.estimated_budget,acStatus:x.status,acNotes:x.notes};Object.entries(map).forEach(([id,v])=>{if($("#"+id))$("#"+id).value=v??"";});window.scrollTo({top:0,behavior:"smooth"});}
async function deleteActivity(id){const x=activityCache.find(a=>a.id===id);if(!x||!confirm(`Xóa hoạt động “${x.activity_name}”?`))return;const {error}=await sb.from("team_activities").delete().eq("id",id);if(error)return alert(error.message);if(selectedActivityId===id)selectedActivityId=null;await loadActivities();renderActivityDetail(null);toast("Đã xóa hoạt động.");}
async function cloneActivity(id){const x=activityCache.find(a=>a.id===id);if(!x)return;const row={...x};delete row.id;delete row.created_at;row.activity_name=`${x.activity_name} (Bản sao)`;row.start_date=null;row.end_date=null;row.start_time=null;row.status="planned";row.created_by=currentUser.id;row.updated_at=new Date().toISOString();const {error}=await sb.from("team_activities").insert(row);if(error)return alert(error.message);await loadActivities();toast("Đã nhân bản hoạt động. Anh mở bản sao để chỉnh ngày và nội dung.");}
function openActivity(id){selectedActivityId=id;const x=activityCache.find(a=>a.id===id);renderActivityListFilteredKeep();renderActivityDetail(x);}
function renderActivityListFilteredKeep(){filterActivities();}
function money(v){return Number(v||0).toLocaleString("vi-VN")+" đ";}
function renderActivityDetail(x){const box=$("#activityDetail");if(!box)return;if(!x){box.innerHTML='<div class="empty">Chọn một hoạt động để xem hồ sơ và dùng AI hỗ trợ.</div>';return;}box.innerHTML=`<div class="section-title"><div><span class="module-badge">${esc(x.activity_type||"Hoạt động")}</span><h3 style="margin:6px 0 0">${esc(x.activity_name)}</h3></div><span class="status-chip status-${esc(x.status)}">${activityStatusIcons[x.status]||"•"} ${esc(activityStatusLabels[x.status]||x.status)}</span></div><div class="detail-grid"><div><small>Chủ đề</small><b>${esc(x.theme||"—")}</b></div><div><small>Thời gian</small><b>${esc(activityDateText(x))}</b></div><div><small>Địa điểm</small><b>${esc(x.location||"—")}</b></div><div><small>Đối tượng</small><b>${esc(x.audience||"—")}</b></div><div><small>Người phụ trách</small><b>${esc(x.person_in_charge||"—")}</b></div><div><small>Kinh phí dự kiến</small><b>${money(x.estimated_budget)}</b></div></div>${x.objectives?`<div class="detail-block"><b>Mục tiêu</b><p>${esc(x.objectives)}</p></div>`:""}${x.main_content?`<div class="detail-block"><b>Nội dung chính</b><p>${esc(x.main_content)}</p></div>`:""}<div class="activity-source-section">
  <div class="section-title compact">
    <div>
      <h4>📎 Nguồn chỉ đạo <span id="activitySourceCount" class="count-badge">0</span></h4>
      <div class="muted">Công văn, kế hoạch hoặc tài liệu cấp trên được lưu trên Google Drive và liên kết đúng hoạt động.</div>
    </div>
    <button class="btn small secondary" onclick="openSourceWorkflowModal('${x.id}')">＋ Thêm nguồn</button>
  </div>
  <div id="activitySourceList" class="source-list"><div class="muted">Đang tải nguồn chỉ đạo...</div></div>
</div><div class="status-control"><label>Đổi trạng thái</label><select onchange="updateActivityStatus('${x.id}',this.value)">${Object.entries(activityStatusLabels).map(([k,v])=>`<option value="${k}" ${x.status===k?"selected":""}>${activityStatusIcons[k]} ${v}</option>`).join("")}</select></div><div class="ai-center"><h4>📚 Bộ tài liệu hoạt động · ✨ AI hỗ trợ hoạt động</h4><div class="muted">AI dùng Hồ sơ Liên đội + Hồ sơ hoạt động hiện tại. Anh không cần nhập lại thông tin.</div><div class="ai-task-grid">${Object.entries(activityAITasks).map(([k,v])=>`<button class="btn secondary" onclick="generateActivityAI('${x.id}','${k}')">${activityAIIcon(k)} ${esc(v[0])}</button>`).join("")}</div><div id="activityAIStatus" class="ai-status"></div><div id="activityAIResult" class="result activity-ai-result">Chọn một tác vụ AI ở trên.</div><div class="ai-actions"><button class="btn secondary" onclick="copyAIResult('activityAIResult')">📋 Sao chép</button><button class="btn secondary" onclick="downloadText('activityAIResult','hoat-dong-ai')">⬇ Tải .txt</button></div><div class="activity-ai-history-section"><div class="section-title compact"><div><h4>🕘 Sản phẩm AI của hoạt động <span id="activityAIHistoryCount" class="count-badge">0</span></h4><div class="muted">Tự động lấy từ Lịch sử AI theo đúng hoạt động đang mở.</div></div><button class="btn small secondary" onclick="loadActivityAIHistory('${x.id}')">↻ Làm mới</button></div><div id="activityAIHistory" class="activity-ai-history"><div class="muted">Đang tải sản phẩm AI...</div></div></div></div>
<div class="activity-record-section"><div class="section-title compact"><div><h4>📎 Minh chứng hoạt động <span id="activityEvidenceCount" class="count-badge">0</span></h4><div class="muted">Lưu link Google Drive, Fanpage, video, văn bản hoặc mô tả minh chứng.</div></div><button class="btn small primary" onclick="toggleEvidenceForm()">＋ Thêm minh chứng</button></div><div id="evidenceForm" class="record-form hidden"><div class="record-grid"><div><label>Loại minh chứng</label><select id="evType"><option>Ảnh</option><option>Văn bản</option><option>Video</option><option>Liên kết</option><option>Sản phẩm</option><option>Biên bản</option><option>Báo cáo</option><option>Khác</option></select></div><div><label>Ngày minh chứng</label><input id="evDate" type="date"></div><div class="full"><label>Tiêu đề *</label><input id="evTitle" placeholder="Ví dụ: Ảnh toàn cảnh sinh hoạt dưới cờ"></div><div class="full"><label>Liên kết</label><input id="evUrl" placeholder="Google Drive, Fanpage, YouTube..."></div><div class="full"><label>Mô tả</label><textarea id="evDesc" rows="3" placeholder="Mô tả ngắn nội dung minh chứng"></textarea></div></div><div class="action-row"><button class="btn primary" onclick="saveActivityEvidence('${x.id}')">💾 Lưu minh chứng</button><button class="btn secondary" onclick="toggleEvidenceForm(false)">Hủy</button></div></div><div id="activityEvidenceList" class="record-list"><div class="muted">Đang tải minh chứng...</div></div></div>
<div class="activity-record-section"><div class="section-title compact"><div><h4>📊 Kết quả thực hiện</h4><div class="muted">Hoàn thiện sau hoạt động để tạo báo cáo sát thực tế hơn.</div></div><span id="activityResultState" class="pill">Chưa lưu</span></div><div class="record-grid"><div><label>Số người tham gia thực tế</label><input id="rsParticipants" type="number" min="0"></div><div class="full"><label>Kết quả nổi bật</label><textarea id="rsHighlights" rows="3"></textarea></div><div class="full"><label>Điểm nhấn</label><textarea id="rsNotable" rows="2"></textarea></div><div class="full"><label>Hạn chế</label><textarea id="rsLimitations" rows="2"></textarea></div><div class="full"><label>Nguyên nhân</label><textarea id="rsCauses" rows="2"></textarea></div><div class="full"><label>Bài học kinh nghiệm</label><textarea id="rsLessons" rows="2"></textarea></div><div class="full"><label>Kiến nghị</label><textarea id="rsRecommendations" rows="2"></textarea></div><div class="full"><label>Tóm tắt kết quả</label><textarea id="rsSummary" rows="3"></textarea></div></div><div class="action-row"><button class="btn primary" onclick="saveActivityResult('${x.id}')">💾 Lưu kết quả</button></div></div>
<div class="activity-record-section dossier-section"><div class="section-title compact"><div><h4>📁 Hồ sơ hoạt động hoàn chỉnh</h4><div class="muted">Tự động gom Hồ sơ Liên đội + thông tin hoạt động + sản phẩm AI + minh chứng + kết quả thực hiện.</div></div><span id="activityDossierState" class="pill">Chưa tạo</span></div><div class="dossier-actions"><button class="btn primary" onclick="buildActivityDossier('${x.id}')">📁 Tạo / làm mới hồ sơ</button><button id="activityDossierCopyBtn" class="btn secondary" onclick="copyActivityDossier()" disabled>📋 Sao chép</button><button id="activityDossierWordBtn" class="btn secondary" onclick="openWordExportModal()" disabled>📝 Xuất Word .docx</button><button id="activityDossierDownloadBtn" class="btn secondary" onclick="downloadActivityDossier()" disabled>⬇ Tải hồ sơ .txt</button></div><div id="activityDossierMeta" class="dossier-meta muted">Chưa tạo bản tổng hợp.</div><div id="activityDossierPreview" class="dossier-preview">Bấm “Tạo / làm mới hồ sơ” để tổng hợp toàn bộ dữ liệu của hoạt động này.</div></div>`;loadActivityAIHistory(x.id);loadActivityEvidence(x.id);loadActivityResult(x.id);loadActivitySourceFiles(x.id);}
function activityAIIcon(k){return {plan:"📄",mc:"🎤",radio:"🎙️",fanpage:"📱",game:"🎲",quiz:"❓",evidence:"📁",report:"📊"}[k]||"✨";}
async function updateActivityStatus(id,status){const {error}=await sb.from("team_activities").update({status,updated_at:new Date().toISOString()}).eq("id",id);if(error)return alert(error.message);await loadActivities();selectedActivityId=id;renderActivityDetail(activityCache.find(a=>a.id===id));toast("Đã cập nhật trạng thái.");}
function activityPrompt(x,key){const [name,instruction]=activityAITasks[key]||["Hỗ trợ hoạt động","Hỗ trợ nội dung phù hợp."];return `${instruction}\n\nHỒ SƠ HOẠT ĐỘNG:\n- Tên: ${x.activity_name}\n- Loại: ${x.activity_type||""}\n- Chủ đề: ${x.theme||""}\n- Năm học: ${x.school_year||""}\n- Thời gian: ${activityDateText(x)}\n- Địa điểm: ${x.location||""}\n- Đối tượng: ${x.audience||""}\n- Số người dự kiến: ${x.participant_count||""}\n- Người phụ trách: ${x.person_in_charge||""}\n- Lực lượng phối hợp: ${x.coordinating_units||""}\n- Mục tiêu: ${x.objectives||""}\n- Nội dung chính: ${x.main_content||""}\n- Hình thức: ${x.organization_form||""}\n- Yêu cầu: ${x.requirements||""}\n- Kinh phí dự kiến: ${x.estimated_budget||0}\n- Ghi chú: ${x.notes||""}\n\nYêu cầu: không tự bịa số liệu chưa có; chỗ thiếu dữ liệu thì ghi rõ cần bổ sung.`;}
async function buildActivityReportPrompt(x){
  const [evRes,resultRes,historyRes]=await Promise.all([
    sb.from("activity_evidence").select("evidence_type,title,evidence_date,external_url,description").eq("activity_id",x.id).order("evidence_date",{ascending:true,nullsFirst:false}),
    sb.from("activity_results").select("actual_participants,highlights,notable_points,limitations,causes,lessons_learned,recommendations,summary").eq("activity_id",x.id).maybeSingle(),
    sb.from("ai_history").select("title,result,created_at").eq("activity_id",x.id).order("created_at",{ascending:true}).limit(30)
  ]);
  if(evRes.error)throw evRes.error;if(resultRes.error)throw resultRes.error;if(historyRes.error)throw historyRes.error;
  const ev=evRes.data||[],r=resultRes.data||null;
  const products=(historyRes.data||[]).filter(h=>!String(h.title||"").toLowerCase().startsWith("báo cáo kết quả:"));
  const evidenceText=ev.length?ev.map((e,i)=>`${i+1}. [${e.evidence_type||"Minh chứng"}] ${e.title||""}${e.evidence_date?` - ${e.evidence_date}`:""}${e.description?` - ${e.description}`:""}${e.external_url?` - Link: ${e.external_url}`:""}`).join("\n"):"Chưa có minh chứng được lưu.";
  const resultText=r?`- Số người tham gia thực tế: ${r.actual_participants??"Chưa ghi"}\n- Kết quả nổi bật: ${r.highlights||"Chưa ghi"}\n- Điểm nhấn: ${r.notable_points||"Chưa ghi"}\n- Hạn chế: ${r.limitations||"Chưa ghi"}\n- Nguyên nhân: ${r.causes||"Chưa ghi"}\n- Bài học kinh nghiệm: ${r.lessons_learned||"Chưa ghi"}\n- Kiến nghị/đề xuất: ${r.recommendations||"Chưa ghi"}\n- Tóm tắt kết quả: ${r.summary||"Chưa ghi"}`:"Chưa có bản Kết quả thực hiện được lưu.";
  const productsText=products.length?products.map((h,i)=>`--- Sản phẩm ${i+1}: ${h.title||"Nội dung AI"} ---\n${String(h.result||"").slice(0,6000)}`).join("\n\n"):"Chưa có sản phẩm AI trước đó.";
  return `${activityPrompt(x,"report")}\n\nDỮ LIỆU THỰC TẾ ĐÃ LƯU CHO HOẠT ĐỘNG:\n\n1. KẾT QUẢ THỰC HIỆN\n${resultText}\n\n2. MINH CHỨNG HOẠT ĐỘNG (${ev.length})\n${evidenceText}\n\n3. SẢN PHẨM AI ĐÃ GẮN VỚI HOẠT ĐỘNG (${products.length})\n${productsText}\n\nYÊU CẦU LẬP BÁO CÁO:\n- Viết báo cáo kết quả hoạt động hoàn chỉnh, dùng được ngay trong công tác Đội ở trường tiểu học.\n- Ưu tiên tuyệt đối dữ liệu thực tế trong Kết quả thực hiện và Minh chứng; dùng sản phẩm AI cũ chỉ làm ngữ cảnh tham khảo.\n- Phân biệt rõ số người dự kiến và số người tham gia thực tế.\n- Không bịa số liệu, thành tích, đại biểu, kinh phí hoặc minh chứng chưa có.\n- Nếu dữ liệu còn thiếu, diễn đạt trung tính hoặc ghi rõ nội dung cần bổ sung.\n- Cấu trúc nên có: thông tin chung; mục đích/yêu cầu; nội dung tổ chức; kết quả đạt được; minh chứng; ưu điểm; hạn chế/nguyên nhân; bài học kinh nghiệm; kiến nghị/đề xuất; kết luận.\n- Văn phong hành chính giáo dục Việt Nam, mạch lạc, súc tích, phù hợp Liên đội Trường Tiểu học Võ Văn Ngân.`;
}
async function generateActivityAI(id,key){if(demo||!sb)return alert("Cần đăng nhập Supabase để dùng AI thật.");const x=activityCache.find(a=>a.id===id);if(!x)return;await loadProfileCache();const status=$("#activityAIStatus"),out=$("#activityAIResult");if(status)status.textContent=key==="report"?"AI đang đọc Hồ sơ hoạt động + Minh chứng + Kết quả thực tế + Sản phẩm AI...":"AI đang xử lý Hồ sơ Liên đội + Hồ sơ hoạt động...";if(out)out.textContent="Đang tạo nội dung...";const [taskName]=activityAITasks[key];try{const prompt=key==="report"?await buildActivityReportPrompt(x):activityPrompt(x,key);const body={module:"assistant",profile:profileForAI(),task_type:`activity_${key}`,task_name:taskName,audience:x.audience||"",prompt};const {data,error}=await sb.functions.invoke(AI_FUNCTION_NAME,{body});if(error)throw error;if(data?.error)throw new Error(data.error);const text=data?.text||"";if(!text)throw new Error("AI chưa trả về nội dung.");if(out)out.textContent=text;if(status)status.textContent=`✓ Đã tạo bằng ${data.model||"OpenAI"}${key==="report"?" từ dữ liệu thực tế của hoạt động":""}.`;const row={module:"assistant",title:`${taskName}: ${x.activity_name}`,topic:x.activity_name,prompt:body.prompt,result:text,audience:x.audience||null,extra:key==="report"?`Hoạt động: ${x.activity_name} | Báo cáo dùng dữ liệu thực tế + minh chứng`:`Hoạt động: ${x.activity_name}`,created_by:currentUser.id,activity_id:x.id,updated_at:new Date().toISOString()};const {error:hErr}=await sb.from("ai_history").insert(row);if(hErr&&status)status.textContent+=` Chưa lưu lịch sử: ${hErr.message}`;else{toast(key==="report"?"Đã tạo báo cáo từ dữ liệu thực tế và lưu vào lịch sử.":"Đã tạo nội dung và liên kết với hoạt động.");await loadActivityAIHistory(x.id);}}catch(e){if(out)out.textContent="Chưa tạo được nội dung.";if(status)status.textContent="Lỗi: "+(e?.message||e);}}
function activityAIKindFromTitle(title=""){const t=String(title||"").toLowerCase();if(t.includes("kế hoạch"))return "📄";if(t.includes("kịch bản mc"))return "🎤";if(t.includes("phát thanh"))return "🎙️";if(t.includes("fanpage"))return "📱";if(t.includes("trò chơi"))return "🎲";if(t.includes("câu hỏi"))return "❓";if(t.includes("minh chứng"))return "📁";if(t.includes("báo cáo"))return "📊";return "✨";}
async function loadActivityAIHistory(activityId){const box=$("#activityAIHistory"),count=$("#activityAIHistoryCount");if(!box||!sb||demo)return;if(count)count.textContent="…";box.innerHTML='<div class="muted">Đang tải sản phẩm AI...</div>';const {data,error}=await sb.from("ai_history").select("id,title,topic,prompt,result,created_at").eq("activity_id",activityId).order("created_at",{ascending:false}).limit(30);if(error){box.innerHTML=`<div class="activity-ai-history-error">${esc(error.message)}</div>`;if(count)count.textContent="0";return;}const rows=data||[];if(count)count.textContent=String(rows.length);if(!rows.length){box.innerHTML='<div class="empty compact-empty">Chưa có sản phẩm AI nào gắn với hoạt động này.</div>';return;}box.innerHTML=rows.map((r,i)=>`<div class="activity-history-item"><div class="activity-history-head"><div><b>${activityAIKindFromTitle(r.title)} ${esc(r.title||"Nội dung AI")}</b><div class="muted small-text">${new Date(r.created_at).toLocaleString("vi-VN")}</div></div><div class="history-actions"><button class="btn small secondary" onclick="toggleActivityAIHistory('${r.id}')">Xem</button><button class="btn small secondary" onclick="copyActivityAIHistory('${r.id}')">📋 Sao chép</button><button class="btn small soft" onclick="reuseActivityAIHistory('${r.id}')">↻ Dùng lại</button></div></div><div id="activityHistory_${r.id}" class="activity-history-result hidden">${esc(r.result||"")}</div></div>`).join("");window.activityAIHistoryRows=Object.fromEntries(rows.map(r=>[r.id,r]));}
function toggleActivityAIHistory(id){const el=$("#activityHistory_"+id);if(el)el.classList.toggle("hidden");}
async function copyActivityAIHistory(id){const r=window.activityAIHistoryRows?.[id];if(!r)return;try{await navigator.clipboard.writeText(r.result||"");toast("Đã sao chép sản phẩm AI.");}catch{alert("Không sao chép tự động được. Anh mở nội dung rồi sao chép thủ công.");}}
function reuseActivityAIHistory(id){const r=window.activityAIHistoryRows?.[id],out=$("#activityAIResult");if(!r||!out)return;out.textContent=r.result||"";$("#activityAIStatus").textContent="✓ Đã nạp lại sản phẩm AI cũ để sử dụng.";out.scrollIntoView({behavior:"smooth",block:"start"});}


init();


// =====================================================
// V1.5B-03 - BÁO CÁO AI TỪ DỮ LIỆU THỰC TẾ
// =====================================================
let activityEvidenceRows=[];
function toggleEvidenceForm(force){const el=$("#evidenceForm");if(!el)return;const show=typeof force==="boolean"?force:el.classList.contains("hidden");el.classList.toggle("hidden",!show);if(show&&!$("#evDate").value)$("#evDate").value=new Date().toISOString().slice(0,10);}
async function loadActivityEvidence(activityId){const box=$("#activityEvidenceList"),count=$("#activityEvidenceCount");if(!box||!sb||demo)return;const {data,error}=await sb.from("activity_evidence").select("*").eq("activity_id",activityId).order("evidence_date",{ascending:false,nullsFirst:false}).order("created_at",{ascending:false});if(error){box.innerHTML=`<div class="activity-ai-history-error">${esc(error.message)}</div>`;if(count)count.textContent="0";return;}activityEvidenceRows=data||[];if(count)count.textContent=String(activityEvidenceRows.length);box.innerHTML=activityEvidenceRows.length?activityEvidenceRows.map(r=>`<div class="record-item"><div class="record-head"><div><span class="module-badge">${esc(r.evidence_type||"Minh chứng")}</span><b>${esc(r.title||"Minh chứng")}</b><div class="muted small-text">${r.evidence_date?new Date(r.evidence_date+"T00:00:00").toLocaleDateString("vi-VN"):"Chưa ghi ngày"}</div></div><div class="history-actions">${r.external_url?`<button class="btn small secondary" onclick="openEvidenceUrl('${r.id}')">Mở</button>`:""}<button class="btn small danger" onclick="deleteActivityEvidence('${r.id}','${activityId}')">Xóa</button></div></div>${r.description?`<div class="record-desc">${esc(r.description)}</div>`:""}${r.external_url?`<div class="record-url">${esc(r.external_url)}</div>`:""}</div>`).join(""):'<div class="empty compact-empty">Chưa có minh chứng. Bấm “＋ Thêm minh chứng” để bắt đầu.</div>';}
async function saveActivityEvidence(activityId){if(demo||!sb)return alert("Cần kết nối Supabase.");const title=$("#evTitle")?.value.trim();if(!title)return alert("Anh nhập tiêu đề minh chứng trước.");const row={activity_id:activityId,created_by:currentUser.id,evidence_type:$("#evType").value,title,evidence_date:$("#evDate").value||null,external_url:$("#evUrl").value.trim()||null,description:$("#evDesc").value.trim()||null,updated_at:new Date().toISOString()};const {error}=await sb.from("activity_evidence").insert(row);if(error)return alert("Chưa lưu được minh chứng: "+error.message);["evTitle","evUrl","evDesc"].forEach(id=>{if($("#"+id))$("#"+id).value="";});toggleEvidenceForm(false);await loadActivityEvidence(activityId);toast("Đã lưu minh chứng hoạt động.");}
function openEvidenceUrl(id){const r=activityEvidenceRows.find(x=>x.id===id);if(!r?.external_url)return;let u=r.external_url.trim();if(!/^https?:\/\//i.test(u))u="https://"+u;window.open(u,"_blank","noopener,noreferrer");}
async function deleteActivityEvidence(id,activityId){if(!confirm("Xóa minh chứng này?"))return;const {error}=await sb.from("activity_evidence").delete().eq("id",id);if(error)return alert(error.message);await loadActivityEvidence(activityId);toast("Đã xóa minh chứng.");}
async function loadActivityResult(activityId){if(!sb||demo)return;const {data,error}=await sb.from("activity_results").select("*").eq("activity_id",activityId).maybeSingle();if(error){const st=$("#activityResultState");if(st)st.textContent="Lỗi tải";return;}const r=data||{};const map={rsParticipants:r.actual_participants,rsHighlights:r.highlights,rsNotable:r.notable_points,rsLimitations:r.limitations,rsCauses:r.causes,rsLessons:r.lessons_learned,rsRecommendations:r.recommendations,rsSummary:r.summary};Object.entries(map).forEach(([id,v])=>{if($("#"+id))$("#"+id).value=v??"";});const st=$("#activityResultState");if(st){st.textContent=data?"✓ Đã lưu":"Chưa lưu";st.className=data?"pill green":"pill";}}
async function saveActivityResult(activityId){if(demo||!sb)return alert("Cần kết nối Supabase.");const row={activity_id:activityId,created_by:currentUser.id,actual_participants:Number($("#rsParticipants")?.value)||null,highlights:$("#rsHighlights")?.value.trim()||null,notable_points:$("#rsNotable")?.value.trim()||null,limitations:$("#rsLimitations")?.value.trim()||null,causes:$("#rsCauses")?.value.trim()||null,lessons_learned:$("#rsLessons")?.value.trim()||null,recommendations:$("#rsRecommendations")?.value.trim()||null,summary:$("#rsSummary")?.value.trim()||null,updated_at:new Date().toISOString()};const {error}=await sb.from("activity_results").upsert(row,{onConflict:"activity_id"});if(error)return alert("Chưa lưu được kết quả: "+error.message);await loadActivityResult(activityId);toast("Đã lưu kết quả thực hiện.");}


// V1.5B-04: Hồ sơ hoạt động hoàn chỉnh
let currentActivityDossierText="";
let currentActivityDossierName="ho-so-hoat-dong";
let currentActivityDossierActivityId=null;
let pendingAIEditedWordText="";
let pendingWordSourceMode="original";
function dossierVal(v,fallback="Chưa ghi"){const t=String(v??"").trim();return t||fallback;}
function dossierSlug(v){return String(v||"hoat-dong").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/đ/g,"d").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")||"hoat-dong";}
function dossierDate(v){if(!v)return "Chưa ghi";try{return new Date(String(v).slice(0,10)+"T00:00:00").toLocaleDateString("vi-VN");}catch{return String(v);}}
function dossierAIIcon(title=""){return activityAIKindFromTitle(title);}
async function fetchActivityDossierData(activityId){
  const activity=activityCache.find(a=>a.id===activityId);
  if(!activity)throw new Error("Không tìm thấy hoạt động đang mở.");
  await loadProfileCache();
  const [evRes,resultRes,aiRes]=await Promise.all([
    sb.from("activity_evidence").select("*").eq("activity_id",activityId).order("evidence_date",{ascending:true,nullsFirst:false}).order("created_at",{ascending:true}),
    sb.from("activity_results").select("*").eq("activity_id",activityId).maybeSingle(),
    sb.from("ai_history").select("id,title,result,created_at").eq("activity_id",activityId).order("created_at",{ascending:true}).limit(100)
  ]);
  if(evRes.error)throw evRes.error;if(resultRes.error)throw resultRes.error;if(aiRes.error)throw aiRes.error;
  return {activity,profile:cachedProfile||{},evidence:evRes.data||[],result:resultRes.data||null,ai:aiRes.data||[]};
}
function formatActivityDossier({activity:x,profile:p,evidence,result:r,ai}){
  const lines=[];
  lines.push("HỒ SƠ HOẠT ĐỘNG CÔNG TÁC ĐỘI");
  lines.push(dossierVal(p.school_name,"Trường Tiểu học Võ Văn Ngân"));
  lines.push(`Năm học: ${dossierVal(x.school_year||p.school_year)}`);
  lines.push("=".repeat(66));
  lines.push("");
  lines.push("I. THÔNG TIN HOẠT ĐỘNG");
  lines.push(`Tên hoạt động: ${dossierVal(x.activity_name)}`);
  lines.push(`Loại hoạt động: ${dossierVal(x.activity_type)}`);
  lines.push(`Chủ đề: ${dossierVal(x.theme)}`);
  lines.push(`Thời gian: ${dossierDate(x.start_date)}${x.start_time?` lúc ${String(x.start_time).slice(0,5)}`:""}${x.end_date&&x.end_date!==x.start_date?` đến ${dossierDate(x.end_date)}`:""}`);
  lines.push(`Địa điểm: ${dossierVal(x.location)}`);
  lines.push(`Đối tượng: ${dossierVal(x.audience)}`);
  lines.push(`Số người dự kiến: ${x.participant_count??"Chưa ghi"}`);
  lines.push(`Người phụ trách: ${dossierVal(x.person_in_charge)}`);
  lines.push(`Lực lượng phối hợp: ${dossierVal(x.coordinating_units)}`);
  lines.push(`Hình thức tổ chức: ${dossierVal(x.organization_form)}`);
  lines.push(`Kinh phí dự kiến: ${money(x.estimated_budget)}`);
  lines.push(`Trạng thái: ${activityStatusLabels[x.status]||x.status||"Chưa ghi"}`);
  lines.push("");
  lines.push("II. MỤC TIÊU – NỘI DUNG – YÊU CẦU");
  lines.push(`Mục tiêu:
${dossierVal(x.objectives)}`);
  lines.push(`
Nội dung chính:
${dossierVal(x.main_content)}`);
  lines.push(`
Yêu cầu/điều kiện:
${dossierVal(x.requirements)}`);
  if(String(x.notes||"").trim())lines.push(`
Ghi chú:
${x.notes}`);
  lines.push("");
  lines.push(`III. SẢN PHẨM AI ĐÃ TẠO (${ai.length})`);
  if(!ai.length)lines.push("Chưa có sản phẩm AI gắn với hoạt động.");
  ai.forEach((a,i)=>{lines.push(`
${i+1}. ${dossierAIIcon(a.title)} ${dossierVal(a.title,"Nội dung AI")}`);lines.push(`Thời gian tạo: ${new Date(a.created_at).toLocaleString("vi-VN")}`);lines.push(dossierVal(a.result,"(Không có nội dung)"));});
  lines.push("");
  lines.push(`IV. MINH CHỨNG HOẠT ĐỘNG (${evidence.length})`);
  if(!evidence.length)lines.push("Chưa có minh chứng được lưu.");
  evidence.forEach((e,i)=>{lines.push(`${i+1}. [${dossierVal(e.evidence_type,"Khác")}] ${dossierVal(e.title)}`);lines.push(`   Ngày: ${dossierDate(e.evidence_date)}`);if(e.external_url)lines.push(`   Liên kết: ${e.external_url}`);if(e.description)lines.push(`   Mô tả: ${e.description}`);});
  lines.push("");
  lines.push("V. KẾT QUẢ THỰC HIỆN");
  if(!r){lines.push("Chưa có Kết quả thực hiện được lưu.");}
  else{
    lines.push(`Số người tham gia thực tế: ${r.actual_participants??r.actual_participant_count??"Chưa ghi"}`);
    lines.push(`Kết quả nổi bật:
${dossierVal(r.highlights||r.achievements)}`);
    lines.push(`
Điểm nhấn:
${dossierVal(r.notable_points)}`);
    lines.push(`
Hạn chế:
${dossierVal(r.limitations)}`);
    lines.push(`
Nguyên nhân:
${dossierVal(r.causes)}`);
    lines.push(`
Bài học kinh nghiệm:
${dossierVal(r.lessons_learned)}`);
    lines.push(`
Kiến nghị/đề xuất:
${dossierVal(r.recommendations)}`);
    lines.push(`
Tóm tắt kết quả:
${dossierVal(r.summary||r.result_summary)}`);
  }
  lines.push("");
  lines.push("VI. THÔNG TIN HỒ SƠ LIÊN ĐỘI");
  lines.push(`Liên đội: ${dossierVal(p.lien_doi_name,p.school_name||"Chưa ghi")}`);
  lines.push(`Tổng phụ trách: ${dossierVal(p.tong_phu_trach_name)}`);
  lines.push(`Vai trò: ${dossierVal(p.role_name,"Tổng phụ trách Đội")}`);
  lines.push("");
  lines.push("— Hồ sơ được tổng hợp tự động từ ứng dụng Công tác Đội AI —");
  return lines.join("\n");
}
async function buildActivityDossier(activityId){
  if(demo||!sb)return alert("Cần đăng nhập Supabase để tạo hồ sơ hoàn chỉnh.");
  const preview=$("#activityDossierPreview"),state=$("#activityDossierState"),meta=$("#activityDossierMeta");
  if(preview)preview.textContent="Đang tổng hợp dữ liệu hồ sơ...";if(state){state.textContent="Đang tạo";state.className="pill";}
  try{const data=await fetchActivityDossierData(activityId);currentActivityDossierActivityId=activityId;pendingAIEditedWordText="";pendingWordSourceMode="original";currentActivityDossierText=formatActivityDossier(data);currentActivityDossierName=`ho-so-${dossierSlug(data.activity.activity_name||"hoat-dong")}`;if(preview)preview.innerHTML=renderDossierPreview(currentActivityDossierText);if(meta)meta.textContent=`Đã tổng hợp ${data.ai.length} sản phẩm AI • ${data.evidence.length} minh chứng • ${data.result?"có":"chưa có"} kết quả thực hiện.`;if(state){state.textContent="✓ Sẵn sàng";state.className="pill green";}const c=$("#activityDossierCopyBtn"),d=$("#activityDossierDownloadBtn"),w=$("#activityDossierWordBtn");if(c)c.disabled=false;if(d)d.disabled=false;if(w)w.disabled=false;toast("Đã tạo bản tổng hợp hồ sơ hoạt động.");}
  catch(e){if(preview)preview.textContent="Chưa tạo được hồ sơ: "+(e?.message||e);if(state){state.textContent="Lỗi";state.className="pill";}}
}
async function copyActivityDossier(){if(!currentActivityDossierText)return alert("Anh tạo hồ sơ trước.");try{await navigator.clipboard.writeText(currentActivityDossierText);toast("Đã sao chép hồ sơ hoạt động.");}catch{alert("Không sao chép tự động được. Anh có thể chọn nội dung trong bản xem trước để sao chép.");}}
function downloadActivityDossier(){if(!currentActivityDossierText)return alert("Anh tạo hồ sơ trước.");const blob=new Blob(["\ufeff"+currentActivityDossierText],{type:"text/plain;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=(currentActivityDossierName||"ho-so-hoat-dong")+".txt";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast("Đã tải hồ sơ hoạt động .txt");}





// V1.5C-04: Xuất Word dùng chung nhiều trường, không hard-code tên cá nhân
function dossierEscapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function stripInlineMarkdown(s){return String(s??"").replace(/<br\s*\/?>/gi," ").replace(/<\/?div[^>]*>/gi,"").replace(/\*\*(.*?)\*\*/g,"$1").replace(/__(.*?)__/g,"$1").replace(/\*(.*?)\*/g,"$1").replace(/_(.*?)_/g,"$1").replace(/`([^`]+)`/g,"$1").replace(/\[([^\]]+)\]\(([^)]+)\)/g,"$1 ($2)").replace(/^\s*>\s?/,"").trim();}
function normalizeDossierLines(text){const o=[];for(const r0 of String(text||"").split(/\r?\n/)){let r=r0.trim();if(!r){o.push({type:"blank",text:""});continue;}if(/^[-*_]{3,}\s*$/.test(r))continue;const h=r.match(/^(#{1,6})\s+(.+)$/);if(h){o.push({type:"heading",level:h[1].length,text:stripInlineMarkdown(h[2])});continue;}if(/^\|?[\s:|-]+\|[\s:|-]*\|?$/.test(r)&&/---/.test(r))continue;if(/^\|.*\|$/.test(r)){o.push({type:"table",text:r.replace(/^\||\|$/g,"").split("|").map(stripInlineMarkdown).join("  •  ")});continue;}if(/^[-*+]\s+/.test(r)){o.push({type:"bullet",text:stripInlineMarkdown(r.replace(/^[-*+]\s+/,""))});continue;}const n=r.match(/^(\d+)\.\s+(.+)$/);if(n){o.push({type:"number",text:`${n[1]}. ${stripInlineMarkdown(n[2])}`});continue;}o.push({type:"text",text:stripInlineMarkdown(r)});}return o.filter((x,i,a)=>x.type!=="blank"||(i>0&&a[i-1].type!=="blank"));}
function renderDossierPreview(text){const L=normalizeDossierLines(text);let h="",b=false;L.forEach((x,i)=>{if(x.type==="blank"){h+="<div class='dossier-spacer'></div>";return;}const t=dossierEscapeHtml(x.text);if(i===0){h+=`<div class="dossier-doc-title">${t}</div>`;return;}if(!b&&i<=3&&x.type==="text"){h+=`<div class="dossier-doc-meta">${t}</div>`;return;}if(x.type==="heading"||/^[IVXLCDM]+[.\/]\s/.test(x.text)){b=true;h+=x.level>=3?`<h4 class="dossier-doc-subheading">${t}</h4>`:`<h3 class="dossier-doc-heading">${t}</h3>`;return;}if(x.type==="number"){h+=`<div class="dossier-doc-item">${t}</div>`;return;}if(x.type==="bullet"){h+=`<div class="dossier-doc-bullet">- ${t}</div>`;return;}if(x.type==="table"){h+=`<div class="dossier-doc-tableline">${t}</div>`;return;}const m=x.text.match(/^([^:]{1,45}):\s*(.*)$/);if(m){h+=`<div class="dossier-doc-row"><b>${dossierEscapeHtml(m[1])}:</b> ${dossierEscapeHtml(m[2])}</div>`;return;}if(/^—/.test(x.text)){h+=`<div class="dossier-doc-footer">${t}</div>`;return;}h+=`<p>${t}</p>`;});return `<article class="dossier-document">${h}</article>`;}
function xmlEscape(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");}
function wr(t,b=false,sz=26,it=false){return `<w:r><w:rPr>${b?"<w:b/>":""}${it?"<w:i/>":""}<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(t)}</w:t></w:r>`;}
function wp(t,o={}){const {b=false,c=false,r=false,sz=26,after=0,before=0,left=0,first=0,it=false}=o;return `<w:p><w:pPr>${c?'<w:jc w:val="center"/>':r?'<w:jc w:val="right"/>':'<w:jc w:val="both"/>'}<w:spacing w:before="${before}" w:after="${after}" w:line="276" w:lineRule="auto"/><w:ind w:left="${left}" w:firstLine="${first}"/></w:pPr>${wr(t,b,sz,it)}</w:p>`;}
function pageField(){return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;}

// Lấy dữ liệu trường từ Hồ sơ Liên đội; không có thì dùng nhãn trung tính.
function getPortableSchoolProfile(){
 const p=cachedProfile||{};
 const pick=(...ks)=>{for(const k of ks)if(p&&p[k])return String(p[k]).trim();return"";};
 const school=pick("school_name","ten_truong","school","unit_name")||"TRƯỜNG/LIÊN ĐỘI";
 const team=pick("lien_doi_name","team_name","ten_lien_doi")||("LIÊN ĐỘI "+school);
 const council=pick("council_name","hoi_dong_doi","upper_unit")||"HỘI ĐỒNG ĐỘI";
 const locality=pick("locality","dia_danh","location_name")||"........";
 const schoolYear=pick("school_year","nam_hoc")||"........";
 const principal=pick("principal_name","hieu_truong","approver_name")||"";
 const principalTitle=pick("principal_title")||"Hiệu trưởng";
 const leader=pick("tong_phu_trach_name","leader_name","tong_phu_trach","tpt_name","prepared_by")||"";
 const leaderTitle=pick("role_name")||"GV - TPT";
 const documentPrefix=pick("document_prefix")||"LĐ";
 const schoolLogoUrl=pick("school_logo_url","logo_url")||"";
 const doiLogoUrl=pick("doi_logo_url")||"";
 return {school,team,council,locality,schoolYear,principal,principalTitle,leader,leaderTitle,documentPrefix,schoolLogoUrl,doiLogoUrl};
}

function normalizePlainText(s){
  return stripInlineMarkdown(String(s||""))
    .replace(/\r/g,"")
    .replace(/\t/g," ")
    .replace(/[ ]{2,}/g," ")
    .trim();
}
function normalizeHeadingKey(s){
  return normalizePlainText(s).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/đ/g,"d")
    .replace(/[^a-z0-9 ]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}
function parseTextBlocks(text){
  const raw=String(text||"").replace(/\r/g,"");
  const lines=raw.split("\n");
  const blocks=[];
  let current={heading:"",lines:[]};
  const flush=()=>{if(current.heading||current.lines.length){blocks.push(current);current={heading:"",lines:[]};}};
  for(const original of lines){
    let line=original.trim();
    if(!line)continue;
    line=line.replace(/^#{1,6}\s*/,"").replace(/^\*\*(.*?)\*\*$/,"$1").trim();
    const looksHeading=
      /^(I|II|III|IV|V|VI|VII|VIII|IX|X)[\.\-\s]/i.test(line) ||
      /^\d+[\.\)]\s+/.test(line) ||
      /^[A-ZÀ-Ỹ0-9\s\-–—:]{6,}$/.test(line) ||
      /^(Mục đích|Yêu cầu|Nội dung|Tổ chức thực hiện|Kết quả|Hạn chế|Nguyên nhân|Kiến nghị|Bài học|Thông tin hoạt động|Minh chứng|Sản phẩm AI|Kịch bản|Phân công|Chuẩn bị)/i.test(line);
    if(looksHeading && line.length<140){
      flush();
      current.heading=line;
    }else{
      current.lines.push(line);
    }
  }
  flush();
  return blocks;
}
function sectionMatchScore(block,section){
  const hay=normalizeHeadingKey((block.heading||"")+" "+block.lines.slice(0,2).join(" "));
  let score=0;
  for(const k of section.keys||[]){
    const nk=normalizeHeadingKey(k);
    if(nk && hay.includes(nk))score+=block.heading?4:1;
  }
  return score;
}
function genericFallbackBlocks(text){
  const p=normalizePlainText(text).split(/\n+/).map(x=>x.trim()).filter(Boolean);
  if(!p.length)return [];
  const chunk=Math.max(1,Math.ceil(p.length/4));
  const out=[];
  for(let i=0;i<p.length;i+=chunk)out.push(p.slice(i,i+chunk));
  return out;
}
function normalizeDocumentStructure(text,type){
  const schema=DOCUMENT_STRUCTURE_SCHEMAS[type]||DOCUMENT_STRUCTURE_SCHEMAS.dossier;
  const blocks=parseTextBlocks(text);
  const used=new Set();
  const sections=schema.sections.map(sec=>({title:sec.title,items:[]}));

  blocks.forEach((b,bi)=>{
    let best=-1,bestScore=0;
    schema.sections.forEach((sec,si)=>{
      const s=sectionMatchScore(b,sec);
      if(s>bestScore){bestScore=s;best=si;}
    });
    if(best>=0&&bestScore>0){
      const content=[];
      if(b.heading && !normalizeHeadingKey(b.heading).includes(normalizeHeadingKey(schema.sections[best].title.replace(/^[IVX]+\.\s*/,"")))) content.push(b.heading);
      content.push(...b.lines);
      sections[best].items.push(...content);
      used.add(bi);
    }
  });

  const leftovers=[];
  blocks.forEach((b,bi)=>{
    if(!used.has(bi)){
      if(b.heading)leftovers.push(b.heading);
      leftovers.push(...b.lines);
    }
  });

  // Put unmatched content in the most generally suitable section.
  if(leftovers.length){
    let fallbackIndex=type==="report"?1:type==="script"?1:type==="dossier"?1:2;
    fallbackIndex=Math.min(fallbackIndex,sections.length-1);
    sections[fallbackIndex].items.push(...leftovers);
  }

  // If parsing yielded almost nothing, distribute plain text conservatively.
  const total=sections.reduce((n,s)=>n+s.items.length,0);
  if(total===0){
    const chunks=genericFallbackBlocks(text);
    chunks.forEach((c,i)=>sections[Math.min(i,sections.length-1)].items.push(...c));
  }

  return sections;
}
function documentStructurePreview(type){
  return (DOCUMENT_STRUCTURE_SCHEMAS[type]||DOCUMENT_STRUCTURE_SCHEMAS.dossier).sections.map(x=>x.title);
}
function normalizedBodyXml(text,type){
  const sections=normalizeDocumentStructure(text,type);
  let xml="";
  sections.forEach(sec=>{
    xml+=wp(sec.title,{b:true,sz:26,before:110,after:40});
    const items=sec.items.length?sec.items:["(Chưa có dữ liệu trong hồ sơ hiện tại)"];
    items.forEach(item=>{
      const cleaned=cleanExportText(normalizePlainText(item));
      if(!cleaned)return;
      const isBullet=/^[-•]\s*/.test(cleaned);
      xml+=wp(cleaned.replace(/^[-•]\s*/,""),{sz:26,first:isBullet?0:567,left:isBullet?420:0,before:0,after:0});
    });
  });
  return xml;
}
function inferDocumentKind(text){
 const s=stripInlineMarkdown(String(text||"")).toLowerCase();
 if(/\bbáo cáo\b/.test(s))return {code:"BC",title:"BÁO CÁO"};
 if(/\bkế hoạch\b/.test(s))return {code:"KH",title:"KẾ HOẠCH"};
 if(/\bkịch bản\b/.test(s))return {code:"KB",title:"KỊCH BẢN"};
 return {code:"HS",title:"HỒ SƠ HOẠT ĐỘNG"};
}
function dossierBodyXml(text){const L=normalizeDossierLines(text),p=[];L.forEach((x,i)=>{const s=x.text;if(x.type==="blank")return;if(i===0){p.push(wp(s,{b:true,c:true,sz:30,after:20}));return;}if(i===1){p.push(wp(s.toUpperCase(),{b:true,c:true,sz:28,after:10}));return;}if(i===2&&/^Năm học:/i.test(s)){p.push(wp(s,{b:true,c:true,sz:26,after:80}));return;}if(x.type==="heading"||/^[IVXLCDM]+[.\/]\s/.test(s)){p.push(wp(s,{b:true,sz:x.level>=3?26:28,before:60,after:15}));return;}if(x.type==="bullet"){p.push(wp("- "+s,{sz:26,left:360}));return;}if(x.type==="number"||x.type==="table"){p.push(wp(s,{sz:26}));return;}if(/^—/.test(s))return;const m=s.match(/^([^:]{1,45}):\s*(.*)$/);if(m){p.push(`<w:p><w:pPr><w:jc w:val="both"/><w:spacing w:after="0" w:line="276" w:lineRule="auto"/></w:pPr>${wr(m[1]+": ",true,26)}${wr(m[2],false,26)}</w:p>`);return;}p.push(wp(s,{sz:26,first:567}));});return p.join("");}
function topTable(P){return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4300"/><w:gridCol w:w="4300"/></w:tblGrid><w:tr><w:tc>${wp(P.council.toUpperCase(),{c:true,sz:24})}${wp(P.team.toUpperCase(),{b:true,c:true,sz:24})}${wp("***",{c:true,sz:24})}</w:tc><w:tc>${wp("ĐỘI TNTP HỒ CHÍ MINH",{b:true,c:true,sz:24})}${wp(`${P.locality}, ngày ..... tháng ..... năm 20.....`,{c:true,it:true,sz:24})}</w:tc></w:tr></w:tbl>`;}
function recipientParagraphs(text){
 const lines=String(text||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 return lines.map(x=>wp("- "+x.replace(/^[-•]\s*/,""),{sz:22})).join("");
}
function signatureTable(P,kind,T){
 const approval=T.approval_enabled!==false;
 const grid=approval?'<w:gridCol w:w="2900"/><w:gridCol w:w="2900"/><w:gridCol w:w="2900"/>':'<w:gridCol w:w="4300"/><w:gridCol w:w="4300"/>';
 const approvalCell=approval?`<w:tc>${wp(T.approval_title||"DUYỆT CỦA BGH",{b:true,c:true,sz:24})}${wp(T.approval_role||P.principalTitle,{b:true,c:true,sz:24})}${wp("",{})}${wp("",{})}${wp("(Ký, ghi rõ họ tên)",{c:true,it:true,sz:20})}${P.principal?wp(P.principal,{b:true,c:true,sz:24}):""}</w:tc>`:"";
 return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid><w:tr><w:tc>${wp("Nơi nhận:",{b:true,it:true,sz:24})}${recipientParagraphs(T.recipients)}</w:tc>${approvalCell}<w:tc>${wp(T.signer_title||"NGƯỜI LẬP",{b:true,c:true,sz:24})}${wp(T.signer_role||P.leaderTitle,{b:true,c:true,sz:24})}${wp("",{})}${wp("",{})}${wp("(Ký, ghi rõ họ tên)",{c:true,it:true,sz:20})}${P.leader?wp(P.leader,{b:true,c:true,sz:24}):""}</w:tc></w:tr></w:tbl>`;
}
function documentXml(text,T,normalizeStructure=true,forcedType=null){
 const P=getPortableSchoolProfile(),detected=inferDocumentKind(text),K={...detected,type:forcedType||detected.type},tpl=T||mergedDocumentTemplate(K.type);
 const top=cmToTwips(tpl.margin_top||2),right=cmToTwips(tpl.margin_right||2),bottom=cmToTwips(tpl.margin_bottom||2),left=cmToTwips(tpl.margin_left||3);
 const closing=tpl.closing_sentence?wp(tpl.closing_sentence,{sz:26,first:567,before:50,after:40}):"";
 const safeText=cleanExportText(text); const bodyXml=normalizeStructure?normalizedBodyXml(safeText,K.type):dossierBodyXml(safeText);
 return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${topTable(P)}${wp(`Số: ...../${tpl.code_prefix||K.code+"-"+P.documentPrefix}`,{sz:24})}${bodyXml}${closing}${signatureTable(P,K,tpl)}<w:sectPr><w:headerReference w:type="default" r:id="rId2" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><w:footerReference w:type="default" r:id="rId3" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${top}" w:right="${right}" w:bottom="${bottom}" w:left="${left}" w:header="500" w:footer="500"/></w:sectPr></w:body></w:document>`;
}

function resolveWordExportType(){
  const detected=inferDocumentKind(currentActivityDossierText||"");
  return pendingWordExportType==="auto"?detected.type:pendingWordExportType;
}
async function openWordExportModal(){
  if(!currentActivityDossierText)return alert("Anh/chị tạo hồ sơ hoặc nội dung trước khi xuất Word.");
  await loadDocumentTemplateCache();
  pendingWordExportType="auto";
  pendingAIEditedWordText="";
  pendingWordSourceMode="original";
  if($("#wordAIEditPreviewWrap"))$("#wordAIEditPreviewWrap").classList.add("hidden");
  if($("#wordAIEditPreview"))$("#wordAIEditPreview").value="";
  if($("#wordAIEditStatus"))$("#wordAIEditStatus").textContent="Chưa biên tập AI.";
  if($("#wordNormalizeStructure"))$("#wordNormalizeStructure").checked=true;
  const sel=$("#wordExportTemplateSelect");
  if(sel)sel.value="auto";
  refreshWordExportPreview();
  $("#wordExportModal")?.classList.remove("hidden");
  document.body.classList.add("modal-open");
}
function closeWordExportModal(){
  $("#wordExportModal")?.classList.add("hidden");
  document.body.classList.remove("modal-open");
}
function previewDateText(T,P){
  if(T.date_style==="current"){
    const d=new Date();
    return `${P.locality||"........"}, ngày ${String(d.getDate()).padStart(2,"0")} tháng ${String(d.getMonth()+1).padStart(2,"0")} năm ${d.getFullYear()}`;
  }
  return `${P.locality||"........"}, ngày ..... tháng ..... năm 20.....`;
}
function refreshWordExportPreview(){
  const sel=$("#wordExportTemplateSelect");
  pendingWordExportType=sel?.value||"auto";
  const detected=inferDocumentKind(currentActivityDossierText||"");
  const finalType=resolveWordExportType();
  const T=mergedDocumentTemplate(finalType);
  const P=getPortableSchoolProfile();

  if($("#wordDetectedHint")){
    $("#wordDetectedHint").innerHTML=pendingWordExportType==="auto"
      ? `✨ AI đang nhận diện nội dung là <b>${(DOCUMENT_TEMPLATE_DEFAULTS[detected.type]||{}).label||detected.type}</b>.`
      : `👆 Anh/chị đang chủ động chọn mẫu <b>${T.label}</b>, không phụ thuộc nhận diện tự động.`;
  }

  $("#wordPreviewCode").textContent=T.code_prefix||"—";
  $("#wordPreviewTitle").textContent=T.default_title||T.label||"—";
  $("#wordPreviewMargins").textContent=`T ${T.margin_top} • D ${T.margin_bottom} • Tr ${T.margin_left} • P ${T.margin_right} cm`;
  $("#wordPreviewTypography").textContent=`${T.font_size||13} pt • ${T.line_spacing||1.15}`;
  $("#wordPreviewCouncil").textContent=(P.council||"HỘI ĐỒNG ĐỘI").toUpperCase();
  $("#wordPreviewTeam").textContent=(P.team||"LIÊN ĐỘI").toUpperCase();
  $("#wordPreviewNumber").textContent=`Số: ...../${T.code_prefix||"..."}`;
  $("#wordPreviewDate").textContent=previewDateText(T,P);
  $("#wordPreviewHeading").textContent=T.default_title||T.label?.toUpperCase()||"VĂN BẢN";

  const rec=String(T.recipients||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  $("#wordPreviewRecipients").innerHTML=rec.length?rec.slice(0,4).map(x=>`<div>- ${dossierEscapeHtml(x.replace(/^[-•]\s*/,""))}</div>`).join(""):"<div>- ...</div>";

  const approvalCol=$("#wordPreviewApprovalCol");
  if(approvalCol)approvalCol.style.display=T.approval_enabled===false?"none":"flex";
  $("#wordPreviewApprovalTitle").textContent=T.approval_title||"DUYỆT CỦA BGH";
  $("#wordPreviewApprovalRole").textContent=T.approval_role||P.principalTitle||"Hiệu trưởng";
  $("#wordPreviewSignerTitle").textContent=T.signer_title||"NGƯỜI LẬP";
  $("#wordPreviewSignerRole").textContent=T.signer_role||P.leaderTitle||"GV - TPT";
}

function selectedWordSourceText(){
  return pendingWordSourceMode==="ai" && pendingAIEditedWordText
    ? pendingAIEditedWordText
    : currentActivityDossierText;
}
function documentTypeWritingGuide(type){
  const guides={
    plan:"Văn phong hành chính giáo dục, rõ mục đích, yêu cầu, nội dung, tiến độ, phân công và tổ chức thực hiện. Câu ngắn gọn, khả thi, dùng động từ hành động.",
    report:"Văn phong báo cáo hành chính, ưu tiên kết quả thực tế, minh chứng, hạn chế, nguyên nhân, bài học và kiến nghị. Không biến kế hoạch thành kết quả đã thực hiện.",
    program:"Văn phong chương trình công tác, thể hiện mục tiêu, nội dung trọng tâm, tiến độ và phân công phối hợp theo trình tự hợp lý.",
    dossier:"Văn phong hồ sơ lưu trữ, trung tính, đầy đủ, dễ kiểm tra đối chiếu giữa hoạt động, sản phẩm AI, minh chứng và kết quả.",
    script:"Văn phong kịch bản thực hành, rõ thời gian, nội dung, lời dẫn, người phụ trách và yêu cầu kỹ thuật. Lời dẫn tự nhiên, có thể đọc trực tiếp."
  };
  return guides[type]||guides.dossier;
}
function buildWordAIEditPrompt(type,T){
  const schema=DOCUMENT_STRUCTURE_SCHEMAS[type]||DOCUMENT_STRUCTURE_SCHEMAS.dossier;
  const sectionList=schema.sections.map(x=>x.title).join("\n");
  return `Bạn là biên tập viên văn bản hành chính - giáo dục, chuyên Công tác Đội trong trường học.

NHIỆM VỤ:
Biên tập lại nội dung nguồn bên dưới thành văn bản loại "${T.label||type}" trước khi xuất Word.

NGUYÊN TẮC BẮT BUỘC:
1. Tuyệt đối không bịa số liệu, thời gian, người tham gia, kết quả, minh chứng, tên người hoặc sự kiện.
2. Chỉ sử dụng dữ kiện có trong nội dung nguồn. Nếu thiếu dữ liệu quan trọng, ghi rõ "(Chưa có dữ liệu trong hồ sơ hiện tại)".
3. Không được biến dữ liệu kế hoạch/dự kiến thành kết quả thực tế.
4. Không xóa các dữ kiện, minh chứng hoặc số liệu có giá trị.
5. Có thể gộp câu trùng lặp, chỉnh chính tả, câu văn, liên kết ý và chuyển nội dung vào đúng mục.
6. Không dùng Markdown (#, **, ---). Trả về văn bản thuần, có các đề mục rõ ràng.
7. Không thêm phần đầu cơ quan, số văn bản, nơi nhận hoặc chữ ký; app sẽ tự tạo các phần đó.
8. Giữ văn phong chuẩn hành chính giáo dục Việt Nam, súc tích, rõ ràng, dễ dùng ngay.

VĂN PHONG RIÊNG:
${documentTypeWritingGuide(type)}

CẤU TRÚC MỤC TIÊU:
${sectionList}

NỘI DUNG NGUỒN:
--- BẮT ĐẦU NGUỒN ---
${currentActivityDossierText}
--- KẾT THÚC NGUỒN ---

Hãy trả về duy nhất nội dung đã biên tập.`;
}
async function aiEditDocumentForWord(){
  if(demo||!sb)return alert("Cần đăng nhập Supabase để dùng AI biên tập.");
  if(!currentActivityDossierText)return alert("Chưa có nội dung hồ sơ để biên tập.");
  await loadProfileCache();
  const type=resolveWordExportType();
  const T=mergedDocumentTemplate(type);
  const btn=$("#wordAIEditBtn"),status=$("#wordAIEditStatus"),wrap=$("#wordAIEditPreviewWrap"),preview=$("#wordAIEditPreview");
  if(btn)btn.disabled=true;
  if(status)status.textContent="AI đang biên tập theo loại văn bản đã chọn...";
  if(wrap)wrap.classList.add("hidden");
  try{
    const body={
      module:"assistant",
      profile:profileForAI(),
      task_type:"document_editor",
      task_name:`Biên tập ${T.label||type} trước khi xuất Word`,
      audience:"Hồ sơ Công tác Đội",
      prompt:buildWordAIEditPrompt(type,T)
    };
    const {data,error}=await sb.functions.invoke(AI_FUNCTION_NAME,{body});
    if(error)throw error;
    if(data?.error)throw new Error(data.error);
    const text=String(data?.text||"").trim();
    if(!text)throw new Error("AI chưa trả về nội dung.");
    pendingAIEditedWordText=text;
    pendingWordSourceMode="original";
    if(preview)preview.value=text;
    if(wrap)wrap.classList.remove("hidden");
    if(status)status.textContent=`✓ Đã biên tập bằng ${data.model||"OpenAI"}. Anh/chị xem lại rồi chọn “Dùng bản AI để xuất”.`;

    if(!demo && currentUser?.id){
      const row={
        module:"assistant",
        title:`Biên tập Word: ${T.label||type}`,
        topic:currentActivityDossierName||"Hồ sơ hoạt động",
        prompt:body.prompt,
        result:text,
        audience:"Hồ sơ Công tác Đội",
        extra:`V1.6B-04 | Loại văn bản: ${type} | Chế độ khóa dữ kiện gốc`,
        created_by:currentUser.id,
        activity_id:currentActivityDossierActivityId||null,
        updated_at:new Date().toISOString()
      };
      const {error:hErr}=await sb.from("ai_history").insert(row);
      if(hErr && status)status.textContent+=` Chưa lưu lịch sử: ${hErr.message}`;
    }
  }catch(e){
    if(status)status.textContent="Lỗi biên tập AI: "+(e?.message||e);
  }finally{
    if(btn)btn.disabled=false;
  }
}
function useAIEditedWordText(){
  if(!pendingAIEditedWordText)return alert("Chưa có bản AI để sử dụng.");
  pendingWordSourceMode="ai";
  if($("#wordAIEditStatus"))$("#wordAIEditStatus").textContent="✓ Sẽ xuất Word bằng bản AI đã biên tập.";
  toast("Đã chọn bản AI để xuất Word.");
}
function useOriginalWordText(){
  pendingWordSourceMode="original";
  if($("#wordAIEditStatus"))$("#wordAIEditStatus").textContent=pendingAIEditedWordText
    ?"Đã chuyển về bản gốc. Bản AI vẫn được giữ để anh/chị có thể chọn lại."
    :"Đang dùng bản gốc.";
  toast("Đã chọn lại bản gốc.");
}

async function confirmWordExport(){
  const normalizeStructure=$("#wordNormalizeStructure")?.checked!==false;
  const sourceText=selectedWordSourceText();
  closeWordExportModal();
  await downloadActivityDossierWord(resolveWordExportType(),normalizeStructure,sourceText);
}
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&!$("#wordExportModal")?.classList.contains("hidden"))closeWordExportModal();
});

async function downloadActivityDossierWord(forcedType=null,normalizeStructure=true,sourceText=null){
 const exportText=sourceText||currentActivityDossierText;if(!exportText)return alert("Anh tạo hồ sơ trước.");if(typeof JSZip==="undefined")return alert("Chưa tải được thư viện xuất Word.");
 try{
  await loadDocumentTemplateCache();
  const kind=inferDocumentKind(exportText);
  const selectedType=forcedType||kind.type;
  const tpl=mergedDocumentTemplate(selectedType);
  const z=new JSZip(),P=getPortableSchoolProfile();
  z.file("[Content_Types].xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`);z.folder("_rels").file(".rels",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);const w=z.folder("word");w.file("document.xml",documentXml(exportText,tpl,normalizeStructure,selectedType));w.folder("_rels").file("document.xml.rels",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`);w.file("header1.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${wp(P.team.toUpperCase()+" - HỒ SƠ HOẠT ĐỘNG",{c:true,sz:18})}</w:hdr>`);w.file("footer1.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${pageField()}</w:ftr>`);const normalSz=Math.round((tpl.font_size||13)*2),normalLine=lineSpacingToTwips(tpl.line_spacing||1.15);w.file("styles.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:jc w:val="both"/><w:spacing w:after="0" w:line="${normalLine}" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="${normalSz}"/><w:szCs w:val="${normalSz}"/></w:rPr></w:style></w:styles>`);const blob=await z.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=(currentActivityDossierName||"ho-so-hoat-dong")+".docx";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1500);toast("Đã xuất Word dùng chung nhiều trường.");}catch(e){alert("Chưa xuất được Word: "+(e?.message||e));}
}




// =====================================================
// V1.7C-01 - GOOGLE DRIVE SOURCE WORKFLOW
// Công văn → Drive → activity_id → AI đọc → Kế hoạch trường
// =====================================================
let googleDriveToken="";
let googleDriveTokenExpiresAt=0;
let googleTokenClient=null;
let pendingSourceFile=null;
let pendingSourceTargetActivityId=null;
let activitySourceRows=[];

const SOURCE_AI_FUNCTION_NAME=window.APP_CONFIG?.SOURCE_AI_FUNCTION_NAME||"doi-source-ai";
const GOOGLE_CLIENT_ID=window.APP_CONFIG?.GOOGLE_CLIENT_ID||"";
const GOOGLE_DRIVE_ROOT_FOLDER_ID=window.APP_CONFIG?.GOOGLE_DRIVE_ROOT_FOLDER_ID||"";
const DRIVE_SCOPE="https://www.googleapis.com/auth/drive.file";

function openSourceWorkflowModal(activityId=null){
  pendingSourceTargetActivityId=activityId||null;
  pendingSourceFile=null;
  const input=$("#sourceFileInput"); if(input)input.value="";
  if($("#sourceFileTitle"))$("#sourceFileTitle").textContent="Chọn công văn / kế hoạch / ảnh";
  if($("#sourceFileMeta"))$("#sourceFileMeta").textContent="PDF, DOCX, TXT, JPG, PNG, WEBP · tối đa 15 MB";
  $("#sourceWorkflowProgress")?.classList.add("hidden");
  $("#sourceAnalysisPreview")?.classList.add("hidden");
  updateDriveConnectionUI();
  $("#sourceWorkflowModal")?.classList.remove("hidden");
  document.body.classList.add("modal-open");
}
function closeSourceWorkflowModal(){
  $("#sourceWorkflowModal")?.classList.add("hidden");
  document.body.classList.remove("modal-open");
}
function sourceFileChanged(file){
  pendingSourceFile=file||null;
  if(!file)return;
  const mb=(file.size/1024/1024).toFixed(2);
  $("#sourceFileTitle").textContent=file.name;
  $("#sourceFileMeta").textContent=`${file.type||"Không rõ định dạng"} · ${mb} MB`;
}
function updateDriveConnectionUI(){
  const state=$("#driveConnectionState"),btn=$("#driveConnectBtn");
  const valid=googleDriveToken && Date.now()<googleDriveTokenExpiresAt-60000;
  if(state)state.textContent=valid?"✓ Đã kết nối":"Chưa kết nối";
  if(state)state.className=valid?"connected":"";
  if(btn)btn.textContent=valid?"✓ Drive đã kết nối":"🔗 Kết nối Drive";
}
function ensureGoogleClientReady(){
  if(!GOOGLE_CLIENT_ID)throw new Error("Chưa cấu hình GOOGLE_CLIENT_ID trong config.js.");
  if(location.protocol==="file:")throw new Error("Google Drive OAuth không chạy bằng file://. Hãy mở app bằng START-APP.bat hoặc GitHub Pages.");
  if(!window.google?.accounts?.oauth2)throw new Error("Google Identity Services chưa tải xong. Anh thử lại sau vài giây.");
}
function connectGoogleDrive(){
  try{ensureGoogleClientReady()}catch(e){alert(e.message);return Promise.reject(e);}
  return new Promise((resolve,reject)=>{
    googleTokenClient=google.accounts.oauth2.initTokenClient({
      client_id:GOOGLE_CLIENT_ID,
      scope:DRIVE_SCOPE,
      callback:(resp)=>{
        if(resp?.error){reject(new Error(resp.error));return;}
        googleDriveToken=resp.access_token||"";
        googleDriveTokenExpiresAt=Date.now()+((resp.expires_in||3600)*1000);
        updateDriveConnectionUI();resolve(googleDriveToken);
      }
    });
    googleTokenClient.requestAccessToken({prompt:googleDriveToken?"":"consent"});
  });
}
async function ensureGoogleDriveToken(){
  if(googleDriveToken && Date.now()<googleDriveTokenExpiresAt-60000)return googleDriveToken;
  return await connectGoogleDrive();
}
async function driveFetch(url,options={}){
  const token=await ensureGoogleDriveToken();
  const headers=new Headers(options.headers||{});
  headers.set("Authorization","Bearer "+token);
  const r=await fetch(url,{...options,headers});
  if(!r.ok){
    const t=await r.text();
    throw new Error(`Google Drive: ${r.status} ${t.slice(0,400)}`);
  }
  if(r.status===204)return null;
  return await r.json();
}
function driveEscapeQuery(v){return String(v||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");}
async function driveFindFolder(name,parentId=null){
  const parts=[`mimeType='application/vnd.google-apps.folder'`,`trashed=false`,`name='${driveEscapeQuery(name)}'`];
  if(parentId)parts.push(`'${driveEscapeQuery(parentId)}' in parents`);
  const q=encodeURIComponent(parts.join(" and "));
  const data=await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,parents,webViewLink)&pageSize=10`);
  return data?.files?.[0]||null;
}
async function driveCreateFolder(name,parentId=null){
  const body={name,mimeType:"application/vnd.google-apps.folder"};
  if(parentId)body.parents=[parentId];
  return await driveFetch("https://www.googleapis.com/drive/v3/files?fields=id,name,parents,webViewLink",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
}
async function driveEnsureFolder(name,parentId=null){
  const found=await driveFindFolder(name,parentId);
  return found||await driveCreateFolder(name,parentId);
}
async function getDriveRootFolder(){
  if(GOOGLE_DRIVE_ROOT_FOLDER_ID)return {id:GOOGLE_DRIVE_ROOT_FOLDER_ID,name:"CÔNG TÁC ĐỘI AI"};
  const saved=localStorage.getItem("doi_ai_drive_root_id");
  if(saved)return {id:saved,name:"CÔNG TÁC ĐỘI AI"};
  const folder=await driveEnsureFolder("CÔNG TÁC ĐỘI AI",null);
  localStorage.setItem("doi_ai_drive_root_id",folder.id);
  return folder;
}
async function getDriveYearFolder(){
  const root=await getDriveRootFolder();
  const year=(cachedProfile?.school_year||"2026-2027").trim()||"2026-2027";
  return await driveEnsureFolder(`Năm học ${year}`,root.id);
}
async function getDriveInboxFolder(){
  const yearFolder=await getDriveYearFolder();
  return await driveEnsureFolder("00_Inbox_Cong_van",yearFolder.id);
}
function driveSafeName(v){
  return String(v||"Hoat dong").replace(/[\\/:*?"<>|]+/g," ").replace(/\s+/g," ").trim().slice(0,120);
}
async function getDriveActivitySourceFolder(activity){
  const yearFolder=await getDriveYearFolder();
  const activityFolder=await driveEnsureFolder(driveSafeName(activity.activity_name),yearFolder.id);
  const sourceFolder=await driveEnsureFolder("01_Nguon-cong-van",activityFolder.id);
  return {activityFolder,sourceFolder};
}
async function driveUploadFile(file,parentId){
  const metadata={name:file.name,parents:[parentId]};
  const boundary="-------doi-ai-"+crypto.randomUUID();
  const metaBlob=new Blob([JSON.stringify(metadata)],{type:"application/json; charset=UTF-8"});
  const body=new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    metaBlob,
    `\r\n--${boundary}\r\nContent-Type: ${file.type||"application/octet-stream"}\r\n\r\n`,
    file,
    `\r\n--${boundary}--`
  ],{type:`multipart/related; boundary=${boundary}`});
  const token=await ensureGoogleDriveToken();
  const r=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,parents,webViewLink",{
    method:"POST",
    headers:{"Authorization":"Bearer "+token,"Content-Type":`multipart/related; boundary=${boundary}`},
    body
  });
  if(!r.ok)throw new Error("Không tải được file lên Drive: "+(await r.text()).slice(0,500));
  return await r.json();
}
async function driveMoveFile(fileId,newParentId,oldParentId){
  const url=`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?addParents=${encodeURIComponent(newParentId)}&removeParents=${encodeURIComponent(oldParentId)}&fields=id,name,parents,webViewLink`;
  return await driveFetch(url,{method:"PATCH"});
}
async function fileToBase64(file){
  return await new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(String(r.result).split(",")[1]||"");
    r.onerror=()=>reject(r.error||new Error("Không đọc được file."));
    r.readAsDataURL(file);
  });
}
async function extractDocxText(file){
  const buf=await file.arrayBuffer();
  const zip=await JSZip.loadAsync(buf);
  const xml=await zip.file("word/document.xml")?.async("string");
  if(!xml)return "";
  const doc=new DOMParser().parseFromString(xml,"application/xml");
  return [...doc.getElementsByTagName("w:t")].map(n=>n.textContent||"").join(" ").replace(/\s+/g," ").trim();
}
async function sourceAnalysisPayload(file){
  const ext=(file.name.split(".").pop()||"").toLowerCase();
  if(ext==="docx"){
    return {extracted_text:await extractDocxText(file),file_name:file.name,mime_type:file.type||"application/vnd.openxmlformats-officedocument.wordprocessingml.document"};
  }
  if(ext==="txt"){
    return {extracted_text:await file.text(),file_name:file.name,mime_type:file.type||"text/plain"};
  }
  return {file_base64:await fileToBase64(file),file_name:file.name,mime_type:file.type||"application/octet-stream"};
}
async function analyzeSourceFile(file){
  const payload=await sourceAnalysisPayload(file);
  payload.profile=profileForAI();
  payload.instruction="Đọc trung thành tài liệu cấp trên để tạo hoạt động và Kế hoạch triển khai của trường. Không suy diễn ngoài nguồn.";
  const {data,error}=await sb.functions.invoke(SOURCE_AI_FUNCTION_NAME,{body:payload});
  if(error)throw error;
  if(data?.error)throw new Error(data.error);
  if(!data?.analysis)throw new Error("AI chưa trả về kết quả phân tích công văn.");
  return data.analysis;
}
function analysisText(a){
  const arr=Array.isArray(a?.required_content)?a.required_content:[];
  const req=Array.isArray(a?.key_requirements)?a.key_requirements:[];
  return [
    `Tên hoạt động: ${a?.title||"Chưa xác định"}`,
    `Cơ quan ban hành: ${a?.source_agency||"Chưa xác định"}`,
    `Số/ký hiệu: ${a?.source_number||"Chưa xác định"}`,
    `Thời hạn: ${a?.deadline||"Chưa xác định"}`,
    `Đối tượng: ${a?.target_audience||"Chưa xác định"}`,
    `Nội dung bắt buộc: ${arr.join("; ")||"Chưa xác định"}`,
    `Yêu cầu chính: ${req.join("; ")||"Chưa xác định"}`
  ].join("\n");
}
function showSourceAnalysisPreview(a){
  const box=$("#sourceAnalysisPreview");if(!box)return;
  box.innerHTML=`<b>AI đã đọc tài liệu</b><div>${esc(analysisText(a)).replace(/\n/g,"<br>")}</div>`;
  box.classList.remove("hidden");
}
function sourceActivityRow(a,driveLink){
  const date=(a?.suggested_activity_date||"").match(/^\d{4}-\d{2}-\d{2}$/)?.[0]||null;
  return {
    school_year:cachedProfile?.school_year||"2026-2027",
    activity_name:a?.title||"Hoạt động từ công văn cấp trên",
    activity_type:"Khác",
    theme:a?.source_agency?`Theo chỉ đạo của ${a.source_agency}`:"",
    start_date:date,
    end_date:date,
    start_time:null,
    location:a?.location||"",
    audience:a?.target_audience||"",
    participant_count:null,
    person_in_charge:cachedProfile?.tong_phu_trach_name||"",
    coordinating_units:"",
    objectives:Array.isArray(a?.objectives)?a.objectives.join("; "):(a?.objectives||""),
    main_content:Array.isArray(a?.required_content)?a.required_content.join("; "):(a?.required_content||""),
    organization_form:"",
    requirements:Array.isArray(a?.key_requirements)?a.key_requirements.join("; "):(a?.key_requirements||""),
    estimated_budget:0,
    status:"preparing",
    notes:`Nguồn công văn Google Drive: ${driveLink||""}\n${a?.source_summary||""}`.trim(),
    updated_at:new Date().toISOString(),
    created_by:currentUser.id
  };
}
async function saveActivitySourceRecord(activity,driveFile,folder,analysis){
  const row={
    activity_id:activity.id,
    created_by:currentUser.id,
    drive_file_id:driveFile.id,
    drive_web_view_link:driveFile.webViewLink||`https://drive.google.com/file/d/${driveFile.id}/view`,
    drive_folder_id:folder?.id||null,
    file_name:driveFile.name||pendingSourceFile?.name||"Tài liệu nguồn",
    mime_type:pendingSourceFile?.type||driveFile.mimeType||null,
    file_size:pendingSourceFile?.size||null,
    source_kind:"directive",
    analysis_json:analysis
  };
  const {error}=await sb.from("activity_source_files").insert(row);
  if(error)throw error;
  return row;
}
async function generatePlanFromSource(activity,analysis,sourceLink){
  const sourceDigest=analysis?.source_digest||analysis?.source_summary||analysisText(analysis);
  const prompt=`SOẠN KẾ HOẠCH TRIỂN KHAI CỦA NHÀ TRƯỜNG TỪ TÀI LIỆU CẤP TRÊN.

NGUỒN CHỈ ĐẠO:
${sourceDigest}

THÔNG TIN ĐÃ TRÍCH:
${JSON.stringify(analysis,null,2)}

HỒ SƠ HOẠT ĐỘNG CỦA TRƯỜNG:
${activityPrompt(activity,"plan")}

ĐƯỜNG DẪN NGUỒN GOOGLE DRIVE:
${sourceLink||""}

YÊU CẦU:
- Bám sát tuyệt đối yêu cầu của tài liệu cấp trên; không tự thêm yêu cầu trái nguồn.
- Chuyển hóa thành Kế hoạch triển khai phù hợp cấp trường tiểu học.
- Nếu nguồn không có số liệu, kinh phí, thời gian cụ thể thì không bịa.
- Phân biệt rõ yêu cầu cấp trên và phần nhà trường chủ động tổ chức.
- Cấu trúc hành chính rõ ràng: mục đích, yêu cầu, nội dung, thời gian/địa điểm/đối tượng nếu có, tổ chức thực hiện, phân công, báo cáo.
- Không dùng Markdown (#, *, **, ---).
- Không chèn phần cơ quan ban hành, số văn bản, nơi nhận và chữ ký; hệ thống Word sẽ tự trình bày theo mẫu trường.`;
  const body={module:"assistant",profile:profileForAI(),task_type:"activity_plan_from_source",task_name:"Kế hoạch triển khai từ công văn",audience:activity.audience||"",prompt};
  const {data,error}=await sb.functions.invoke(AI_FUNCTION_NAME,{body});
  if(error)throw error;
  if(data?.error)throw new Error(data.error);
  const text=cleanExportText(data?.text||data?.result||"");
  if(!text)throw new Error("AI chưa tạo được Kế hoạch trường.");
  const {error:hErr}=await sb.from("ai_history").insert({
    module:"assistant",
    title:`Kế hoạch hoạt động: ${activity.activity_name}`,
    topic:activity.activity_name,
    prompt,
    result:text,
    audience:activity.audience||null,
    extra:"V1.7C-01 | Tạo từ công văn Google Drive",
    created_by:currentUser.id,
    activity_id:activity.id,
    updated_at:new Date().toISOString()
  });
  if(hErr)throw hErr;
  return text;
}
async function runSourceWorkflow(){
  if(demo||!sb)return alert("Cần đăng nhập Supabase.");
  const file=pendingSourceFile;
  if(!file)return alert("Anh chọn công văn hoặc tài liệu nguồn trước.");
  if(file.size>15*1024*1024)return alert("V1.7C-01 giới hạn file 15 MB để xử lý nhanh.");
  const btn=$("#sourceCreateBtn"),p=$("#sourceWorkflowProgress");
  btn.disabled=true;p.classList.remove("hidden");
  try{
    await loadProfileCache();
    p.textContent="1/5 · Đang kết nối Google Drive…";
    await ensureGoogleDriveToken();

    p.textContent="2/5 · Đang lưu công văn vào Google Drive…";
    const inbox=await getDriveInboxFolder();
    let driveFile=await driveUploadFile(file,inbox.id);

    p.textContent="3/5 · AI đang đọc và trích nội dung công văn…";
    const analysis=await analyzeSourceFile(file);
    showSourceAnalysisPreview(analysis);

    let activity=null;
    if(pendingSourceTargetActivityId){
      activity=activityCache.find(x=>x.id===pendingSourceTargetActivityId);
      if(!activity)throw new Error("Không tìm thấy hoạt động được chọn.");
    }else{
      const row=sourceActivityRow(analysis,driveFile.webViewLink);
      const {data,error}=await sb.from("team_activities").insert(row).select().single();
      if(error)throw error;
      activity=data;activityCache.unshift(activity);
    }

    p.textContent="4/5 · Đang liên kết nguồn với hoạt động…";
    const folders=await getDriveActivitySourceFolder(activity);
    driveFile=await driveMoveFile(driveFile.id,folders.sourceFolder.id,inbox.id);
    await saveActivitySourceRecord(activity,driveFile,folders.sourceFolder,analysis);

    p.textContent="5/5 · AI đang tạo Kế hoạch triển khai của trường…";
    await generatePlanFromSource(activity,analysis,driveFile.webViewLink||`https://drive.google.com/file/d/${driveFile.id}/view`);

    p.textContent="✓ Hoàn tất: đã lưu Drive, liên kết hoạt động và tạo Kế hoạch trường.";
    await loadActivities();
    selectedActivityId=activity.id;
    setTimeout(()=>{
      closeSourceWorkflowModal();
      openActivity(activity.id);
    },650);
  }catch(e){
    console.error(e);
    p.textContent="Chưa hoàn tất: "+(e?.message||e);
  }finally{btn.disabled=false;}
}
async function loadActivitySourceFiles(activityId){
  const box=$("#activitySourceList"),count=$("#activitySourceCount");
  if(!box||!sb||demo)return;
  const {data,error}=await sb.from("activity_source_files").select("*").eq("activity_id",activityId).order("created_at",{ascending:false});
  if(error){
    box.innerHTML=`<div class="activity-ai-history-error">${esc(error.message)}</div>`;
    if(count)count.textContent="0";return;
  }
  activitySourceRows=data||[];
  if(count)count.textContent=String(activitySourceRows.length);
  box.innerHTML=activitySourceRows.length?activitySourceRows.map(r=>{
    const a=r.analysis_json||{};
    return `<div class="source-record">
      <div class="source-record-icon">📄</div>
      <div class="source-record-main">
        <b>${esc(r.file_name||"Tài liệu nguồn")}</b>
        <span>${esc(a.source_agency||"Nguồn chỉ đạo")}${a.source_number?` · ${esc(a.source_number)}`:""}</span>
        <small>${esc(a.source_summary||"Đã liên kết Google Drive")}</small>
      </div>
      <div class="source-record-actions">
        ${r.drive_web_view_link?`<button class="btn small secondary" onclick="window.open('${esc(r.drive_web_view_link)}','_blank','noopener')">Mở Drive</button>`:""}
      </div>
    </div>`;
  }).join(""):'<div class="empty compact-empty">Chưa có công văn/tài liệu nguồn.</div>';
}

function openQuickActivityModal(){$("#qaName").value="";$("#qaDate").value=new Date().toISOString().slice(0,10);$("#qaLocation").value="AI tự đề xuất";$("#qaAudience").value="AI tự đề xuất";document.querySelectorAll("[data-qa-doc]").forEach(x=>x.checked=["plan","script","mc"].includes(x.dataset.qaDoc));$("#quickActivityProgress").classList.add("hidden");$("#quickActivityModal").classList.remove("hidden");document.body.classList.add("modal-open")}
function closeQuickActivityModal(){$("#quickActivityModal")?.classList.add("hidden");document.body.classList.remove("modal-open")}
function selectedQuickDocs(){return [...document.querySelectorAll("[data-qa-doc]:checked")].map(x=>x.dataset.qaDoc)}

async function generateQuickActivityDocument(activityId, taskKey){
  const a=(activityCache||[]).find(x=>x.id===activityId)||currentActivity;
  if(!a) throw new Error("Không tìm thấy hoạt động để tạo tài liệu.");
  const task=activityAITasks[taskKey];
  if(!task) throw new Error("Không tìm thấy loại tài liệu: "+taskKey);

  await loadProfileCache();

  let extraContext="";
  if(taskKey==="report"){
    const [{data:ev},{data:rs},{data:hist}]=await Promise.all([
      sb.from("activity_evidence").select("*").eq("activity_id",activityId).order("evidence_date",{ascending:true}),
      sb.from("activity_results").select("*").eq("activity_id",activityId).maybeSingle(),
      sb.from("ai_history").select("*").eq("activity_id",activityId).order("created_at",{ascending:true})
    ]);
    extraContext=`\nMINH CHỨNG:\n${JSON.stringify(ev||[])}\nKẾT QUẢ THỰC TẾ:\n${JSON.stringify(rs||{})}\nTÀI LIỆU ĐÃ CÓ:\n${JSON.stringify((hist||[]).filter(x=>!String(x.title||"").toLowerCase().includes("báo cáo")))}`;
  }

  const basePrompt=activityPrompt(a,taskKey);
  const prompt=`${basePrompt}${extraContext}
\nYÊU CẦU BỔ SUNG CHO QUY TRÌNH TẠO NHANH:
- Tạo riêng đúng tài liệu "${task[0]}"; không gộp với tài liệu khác.
- Dùng dữ kiện đã có; không bịa số lượng, kinh phí, kết quả, minh chứng hay thành tích.
- Nếu hoạt động chưa diễn ra, không viết kết quả như đã xảy ra.
- Không dùng Markdown: không #, *, **, ---.
- Văn phong tiếng Việt chuẩn, rõ ràng, phù hợp hồ sơ Công tác Đội trường học.`;

  const {data,error}=await sb.functions.invoke(AI_FUNCTION_NAME,{body:{
    module:"assistant",
    profile:profileForAI(),
    task_type:taskKey,
    task_name:task[0],
    audience:a.audience||"Học sinh",
    prompt
  }});
  if(error) throw error;
  if(data?.error) throw new Error(data.error);

  const text=cleanExportText(data?.text||data?.result||data?.output||"");
  if(!text) throw new Error("AI chưa trả về nội dung cho "+task[0]+".");

  const {error:saveErr}=await sb.from("ai_history").insert({
    module:"activity",
    title:task[0],
    topic:a.activity_name||"",
    prompt,
    result:text,
    audience:a.audience||"",
    extra:"Quick Activity Workflow V1.7B-01 HOTFIX-02",
    created_by:currentUser.id,
    activity_id:activityId
  });
  if(saveErr) throw saveErr;
  return text;
}

async function createQuickActivityAndDocuments(){
 const name=$("#qaName").value.trim(),date=$("#qaDate").value,docs=selectedQuickDocs();let location=$("#qaLocation").value,audience=$("#qaAudience").value;
 if(!name)return alert("Anh nhập tên hoạt động.");if(!date)return alert("Anh chọn ngày.");if(!docs.length)return alert("Anh chọn ít nhất một tài liệu.");
 const p=$("#quickActivityProgress"),b=$("#quickActivityCreateBtn");p.classList.remove("hidden");b.disabled=true;
 try{
  p.textContent="1/3 · AI đang tự soạn mục tiêu và nội dung chính…";
  await loadProfileCache();
  const prompt=`Tạo ngữ cảnh chuẩn bị cho hoạt động Công tác Đội: ${name}, ngày ${date}. Địa điểm: ${location}. Đối tượng: ${audience}. Tự đề xuất địa điểm/đối tượng nếu được yêu cầu. Tự soạn mục tiêu và nội dung chính ngắn gọn, khả thi, phù hợp Hồ sơ Liên đội. Không bịa số lượng, kinh phí, kết quả hay minh chứng. Không Markdown. Chỉ trả 4 dòng: ĐỊA ĐIỂM: ...; ĐỐI TƯỢNG: ...; MỤC TIÊU: ...; NỘI DUNG CHÍNH: ...`;
  const {data,error}=await sb.functions.invoke(AI_FUNCTION_NAME,{body:{module:"assistant",profile:profileForAI(),task_type:"quick_activity_context",task_name:"Tạo ngữ cảnh hoạt động nhanh",audience:"Công tác Đội",prompt}});if(error)throw error;if(data?.error)throw new Error(data.error);
  const t=cleanExportText(data?.text||"");const g=l=>{const m=t.match(new RegExp(l+"\\s*:\\s*([^\\n;]+)","i"));return m?m[1].trim():""};
  if(location==="AI tự đề xuất")location=g("ĐỊA ĐIỂM")||"";if(audience==="AI tự đề xuất")audience=g("ĐỐI TƯỢNG")||"";
  const row={school_year:cachedProfile?.school_year||"2026-2027",activity_name:name,activity_type:"Khác",theme:"",start_date:date,end_date:date,start_time:null,location,audience,participant_count:null,person_in_charge:cachedProfile?.tong_phu_trach_name||"",coordinating_units:"",objectives:g("MỤC TIÊU"),main_content:g("NỘI DUNG CHÍNH"),organization_form:"",requirements:"",estimated_budget:0,status:"preparing",notes:"Tạo nhanh bằng AI",updated_at:new Date().toISOString(),created_by:currentUser.id};
  p.textContent="2/3 · Đang tạo hoạt động…";const q=await sb.from("team_activities").insert(row).select().single();if(q.error)throw q.error;currentActivity=q.data;currentActivityId=q.data.id;activityCache.unshift(q.data);
  p.textContent=`3/3 · Đang tạo ${docs.length} tài liệu…`;let i=0;for(const k of docs){const d=getActivityDoc(k);if(!d)continue;p.textContent=`3/3 · ${++i}/${docs.length}: ${d.label}…`;await generateQuickActivityDocument(currentActivityId,d.taskKey)}
  await refreshWorkspaceHistory();p.textContent="✓ Hoàn tất hoạt động và tài liệu.";setTimeout(async()=>{closeQuickActivityModal();await loadActivities();openActivity(currentActivityId)},500)
 }catch(e){console.error(e);p.textContent="Chưa hoàn tất: "+(e?.message||e)}finally{b.disabled=false}
}

const ACTIVITY_DOCUMENT_CATALOG=[
 {key:"plan",icon:"📄",label:"Kế hoạch",taskKey:"plan",docType:"plan",desc:"Kế hoạch tổ chức hoạt động"},
 {key:"script",icon:"🎬",label:"Kịch bản chương trình",taskKey:"script",docType:"script",desc:"Kịch bản chương trình chi tiết"},
 {key:"mc",icon:"🎤",label:"Lời dẫn MC",taskKey:"mc",docType:"script",desc:"Lời dẫn riêng để MC đọc"},
 {key:"radio",icon:"📻",label:"Phát thanh măng non",taskKey:"radio",docType:"script",desc:"Bản phát thanh độc lập"},
 {key:"fanpage",icon:"📱",label:"Tin bài Fanpage",taskKey:"fanpage",docType:"dossier",desc:"Tin truyền thông"},
 {key:"game",icon:"🎲",label:"Trò chơi / tương tác",taskKey:"game",docType:"script",desc:"Trò chơi và cách tổ chức"},
 {key:"questions",icon:"❓",label:"Câu hỏi giao lưu",taskKey:"quiz",docType:"dossier",desc:"Bộ câu hỏi độc lập"},
 {key:"evidence",icon:"📁",label:"Danh mục minh chứng",taskKey:"evidence",docType:"dossier",desc:"Minh chứng cần thu thập"},
 {key:"report",icon:"📊",label:"Báo cáo kết quả",taskKey:"report",docType:"report",desc:"Báo cáo sau hoạt động"}
];
let activityHistoryCache=[];
function getActivityDoc(k){return ACTIVITY_DOCUMENT_CATALOG.find(x=>x.key===k)}
function activityDocumentHistoryFor(doc){
 const task=activityAITasks[doc.taskKey]?.[0]||doc.label;
 return (activityHistoryCache||[]).filter(x=>(!currentActivityId||x.activity_id===currentActivityId)&&((x.title||"")+" "+(x.topic||"")).toLowerCase().includes(task.toLowerCase())).sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
}
async function refreshWorkspaceHistory(){
 if(demo||!sb||!currentActivityId)return;
 const {data}=await sb.from("ai_history").select("*").eq("activity_id",currentActivityId).order("created_at",{ascending:false});
 activityHistoryCache=data||[]; renderActivityWorkspace();
}
async function createIndependentActivityDocument(k){const d=getActivityDoc(k);if(!d||!currentActivityId)return;await generateActivityAI(currentActivityId,d.taskKey);await refreshWorkspaceHistory()}
function previewIndependentActivityDocument(k){const d=getActivityDoc(k),r=d&&activityDocumentHistoryFor(d)[0];if(!r)return alert("Chưa có tài liệu.");const out=$("#activityAIResult");if(out){out.textContent=cleanExportText(r.result||"");out.scrollIntoView({behavior:"smooth",block:"center"})}}
async function exportIndependentActivityDocument(k){
 const d=getActivityDoc(k),r=d&&activityDocumentHistoryFor(d)[0];if(!r)return alert("Chưa có tài liệu.");
 currentActivityDossierText=cleanExportText(r.result||"");currentActivityDossierName=dossierSlug((currentActivity?.activity_name||"hoat-dong")+"-"+d.label);currentActivityDossierActivityId=currentActivityId;
 await loadDocumentTemplateCache();pendingWordExportType=d.docType;pendingAIEditedWordText="";pendingWordSourceMode="original";
 if($("#wordExportTemplateSelect"))$("#wordExportTemplateSelect").value=d.docType;if($("#wordNormalizeStructure"))$("#wordNormalizeStructure").checked=true;
 refreshWordExportPreview();$("#wordExportModal")?.classList.remove("hidden");document.body.classList.add("modal-open");
}

function workspaceDocState(){
  const core=["plan","script","mc","report"];
  const support=["radio","fanpage","game","questions"];
  const evidence=["evidence"];
  const all=[...core,...support,...evidence];
  const exists=key=>{
    const d=getActivityDoc(key);
    return d ? activityDocumentHistoryFor(d).length>0 : false;
  };
  return {
    core, support, evidence, all,
    coreDone:core.filter(exists).length,
    totalDone:all.filter(exists).length,
    exists
  };
}
function switchActivityWorkspaceTab(tab,btn=null){
  activityWorkspaceTab=tab;
  document.querySelectorAll(".workspace-tab").forEach(x=>x.classList.toggle("active",x.dataset.workspaceTab===tab));
  renderActivityWorkspace();
}
function workspaceActivityValue(...keys){
  const a=currentActivity||{};
  for(const k of keys)if(a[k]!==undefined&&a[k]!==null&&String(a[k]).trim()!=="")return a[k];
  return "";
}
function workspaceStatusLabel(){
  return workspaceActivityValue("status","activity_status")||"Chưa xác định";
}
function workspaceNextActions(S){
  const items=[];
  if(!S.exists("plan"))items.push("Tạo Kế hoạch hoạt động");
  else if(!S.exists("script"))items.push("Hoàn thiện Kịch bản chương trình");
  else if(!S.exists("mc"))items.push("Chuẩn bị Lời dẫn MC");
  const st=String(workspaceStatusLabel()).toLowerCase();
  if((st.includes("hoàn")||st.includes("completed"))&&!S.exists("report"))items.push("Nhập kết quả thực tế và tạo Báo cáo kết quả");
  if(!S.exists("evidence"))items.push("Chuẩn bị hoặc bổ sung Danh mục minh chứng");
  return items.slice(0,3);
}
function renderWorkspaceOverview(S){
  const name=workspaceActivityValue("activity_name","title","name")||"Hoạt động";
  const date=workspaceActivityValue("activity_date","date","start_date")||"—";
  const place=workspaceActivityValue("location","place","venue")||"—";
  const audience=workspaceActivityValue("audience","participants","target_group")||"—";
  const goal=workspaceActivityValue("objective","objectives","goal","description")||"—";
  const next=workspaceNextActions(S);
  const pct=Math.round((S.coreDone/S.core.length)*100);
  return `<div class="workspace-overview-grid">
    <div class="workspace-summary-card">
      <div class="workspace-kicker">HOẠT ĐỘNG</div>
      <h3>${dossierEscapeHtml(String(name))}</h3>
      <div class="workspace-info-list">
        <div><span>Thời gian</span><b>${dossierEscapeHtml(String(date))}</b></div>
        <div><span>Địa điểm</span><b>${dossierEscapeHtml(String(place))}</b></div>
        <div><span>Đối tượng</span><b>${dossierEscapeHtml(String(audience))}</b></div>
        <div><span>Trạng thái</span><b>${dossierEscapeHtml(String(workspaceStatusLabel()))}</b></div>
      </div>
      <div class="workspace-goal"><span>Mục tiêu</span><p>${dossierEscapeHtml(String(goal))}</p></div>
    </div>
    <div class="workspace-progress-card">
      <div class="workspace-kicker">TIẾN ĐỘ HỒ SƠ CHÍNH</div>
      <div class="workspace-progress-number">${S.coreDone}/${S.core.length}</div>
      <div class="workspace-progress-bar"><i style="width:${pct}%"></i></div>
      <small>${pct}% tài liệu chính đã hoàn thiện</small>
      <div class="workspace-next">
        <b>Việc nên làm tiếp theo</b>
        ${next.length?next.map((x,i)=>`<div>${i+1}. ${dossierEscapeHtml(x)}</div>`).join(""):"<div>✓ Hồ sơ chính đã khá đầy đủ.</div>"}
      </div>
    </div>
  </div>`;
}
function workspaceDocCard(key,primary=true){
  const doc=getActivityDoc(key); if(!doc)return "";
  const latest=activityDocumentHistoryFor(doc)[0];
  return `<article class="workspace-doc-row">
    <div class="workspace-doc-symbol">${doc.icon}</div>
    <div class="workspace-doc-info">
      <b>${doc.label}</b><span>${doc.desc}</span>
      <small class="${latest?"done":"pending"}">${latest?"✓ Đã có tài liệu":"○ Chưa tạo"}</small>
    </div>
    <div class="workspace-doc-menu">
      <button class="btn ${latest?"secondary":"primary"}" onclick="createIndependentActivityDocument('${doc.key}')">${latest?"Tạo lại":"Tạo bằng AI"}</button>
      ${latest?`<button class="btn soft" onclick="previewIndependentActivityDocument('${doc.key}')">Mở tài liệu</button>
      <button class="workspace-more" title="Xuất Word" onclick="exportIndependentActivityDocument('${doc.key}')">W</button>`:""}
    </div>
  </article>`;
}
function renderWorkspaceDocuments(S){
  const supportHtml=activityWorkspaceShowSupport
    ? `<div class="workspace-subsection support"><div class="workspace-subtitle"><b>Tài liệu hỗ trợ</b><button class="link-btn" onclick="activityWorkspaceShowSupport=false;renderActivityWorkspace()">Thu gọn</button></div>${S.support.map(k=>workspaceDocCard(k,false)).join("")}</div>`
    : `<button class="workspace-add-support" onclick="activityWorkspaceShowSupport=true;renderActivityWorkspace()">＋ Thêm tài liệu hỗ trợ <span>Phát thanh · Fanpage · Trò chơi · Câu hỏi</span></button>`;
  return `<div class="workspace-documents">
    <div class="workspace-subsection">
      <div class="workspace-subtitle"><b>Tài liệu chính</b><span>Chỉ 4 tài liệu quan trọng hiển thị mặc định</span></div>
      ${S.core.map(k=>workspaceDocCard(k,true)).join("")}
    </div>
    ${supportHtml}
    <div class="workspace-subsection">
      <div class="workspace-subtitle"><b>Hồ sơ nghiệp vụ</b><span>Minh chứng phục vụ kiểm tra và báo cáo</span></div>
      ${S.evidence.map(k=>workspaceDocCard(k,false)).join("")}
    </div>
  </div>`;
}
function renderWorkspaceEvidence(){
  return `<div class="workspace-evidence">
    <div class="workspace-callout"><b>Quy trình dữ liệu thật</b><span>Hoạt động thực tế → Minh chứng → Kết quả → Báo cáo. Báo cáo AI nên được tạo sau khi đã nhập kết quả thực hiện.</span></div>
    <div id="workspaceLegacyEvidenceHost"></div>
    <div class="workspace-jump-actions">
      <button class="btn secondary" onclick="focusLegacyActivitySection('minh')">📁 Đi đến Minh chứng</button>
      <button class="btn primary" onclick="focusLegacyActivitySection('kết quả')">📊 Đi đến Kết quả thực hiện</button>
    </div>
  </div>`;
}
function renderWorkspaceHistory(){
  const rows=(activityHistoryCache||[]).filter(x=>!currentActivityId||x.activity_id===currentActivityId);
  return `<div class="workspace-history">
    <div class="workspace-subtitle"><b>Lịch sử AI & phiên bản tài liệu</b><span>${rows.length} sản phẩm</span></div>
    ${rows.length?rows.slice(0,30).map(r=>`<div class="workspace-history-row">
      <div><b>${dossierEscapeHtml(r.title||r.task_name||"Sản phẩm AI")}</b><span>${r.created_at?new Date(r.created_at).toLocaleString("vi-VN"):""}</span></div>
      <button class="btn soft" onclick="openHistoryItem&&openHistoryItem('${r.id}')">Xem</button>
    </div>`).join(""):`<div class="empty-state">Chưa có lịch sử AI cho hoạt động này.</div>`}
  </div>`;
}
function focusLegacyActivitySection(keyword){
  const nodes=[...document.querySelectorAll(".card,section,div")];
  const target=nodes.find(el=>el!==$("#activityWorkspaceContent") && (el.textContent||"").toLowerCase().includes(keyword.toLowerCase()) && (el.textContent||"").length<5000);
  if(target){target.scrollIntoView({behavior:"smooth",block:"start"});target.classList.add("workspace-highlight");setTimeout(()=>target.classList.remove("workspace-highlight"),1800);}
  else toast("Phần này đang dùng biểu mẫu hiện có của hoạt động.");
}
function hideLegacyActivityAIBlock(){
  const nodes=[...document.querySelectorAll(".card,.activity-section,section,div")];
  for(const el of nodes){
    if(el.closest(".activity-workspace"))continue;
    const txt=(el.textContent||"").trim();
    if(txt.includes("AI hỗ trợ hoạt động") && txt.includes("Kế hoạch hoạt động") && txt.includes("Báo cáo kết quả")){
      el.classList.add("legacy-ai-hidden");
      break;
    }
  }
}
function renderActivityWorkspace(){
  const host=$("#activityWorkspaceContent"); if(!host)return;
  const S=workspaceDocState();
  const chip=$("#activityWorkspaceProgress");
  if(chip)chip.textContent=`Hồ sơ chính ${S.coreDone}/${S.core.length}`;
  if(activityWorkspaceTab==="documents")host.innerHTML=renderWorkspaceDocuments(S);
  else if(activityWorkspaceTab==="evidence")host.innerHTML=renderWorkspaceEvidence();
  else if(activityWorkspaceTab==="history")host.innerHTML=renderWorkspaceHistory();
  else host.innerHTML=renderWorkspaceOverview(S);
  hideLegacyActivityAIBlock();
}


