import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, collection, getDocs, getDoc, doc, setDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";

const firebaseConfig = window.PINATAS_FIREBASE || {};
const firebaseReady = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId && firebaseConfig.storageBucket);
let fb = { app:null, auth:null, db:null, storage:null };
if (firebaseReady) {
  fb.app = initializeApp(firebaseConfig);
  fb.auth = getAuth(fb.app);
  fb.db = getFirestore(fb.app);
  fb.storage = getStorage(fb.app);
}

const App = (() => {
  const state = {
    products: [], config: {}, category:"Todas", search:"", adminSearch:"", sort:"featured",
    favorites: JSON.parse(localStorage.getItem("pc_favorites") || "[]"),
    adminTab:"products", user:null, admin:false, editingProduct:null, settings:null
  };
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const money = n => Number(n||0).toLocaleString("es-MX");
  const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const stars = n => {
    const value=Math.max(0,Math.min(5,Number(n)||0));
    return `<span class="stars" aria-label="${value.toFixed(1)} de 5">${[0,1,2,3,4].map(i=>{
      const fill=Math.max(0,Math.min(1,value-i));
      return `<span class="star ${fill>=1?"full":""}" style="--fill:${fill*100}%">★</span>`;
    }).join("")}</span>`;
  };
  const toast = msg => { const el=$("#toast"); el.textContent=msg; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),2500); };
  const isAdmin = () => state.admin;

  async function init(){
    state.config = window.PINATAS_CONFIG || {};
    $("#year").textContent = new Date().getFullYear();
    $("#footerLocation").textContent = state.config.location || "Ostuacán, Chiapas";
    bind();
    applyFallbackBranding();
    if (!firebaseReady) {
      state.products = Array.isArray(window.PINATAS_CATALOGO) ? window.PINATAS_CATALOGO : [];
      renderAll();
      toast("Modo local: falta conectar Firebase");
      return;
    }
    onAuthStateChanged(fb.auth, async user => {
      state.user=user;
      state.admin=Boolean(user && user.uid === window.PINATAS_ADMIN_UID && !user.isAnonymous);
      updateAdminButton();
      await loadSettings();
      await loadProducts();
      if(state.admin) await syncAllRatings();
      else await hydratePublicRatings();
      renderAll();
      if (location.hash.includes("producto=")) handleHash();
    });
    if (!fb.auth.currentUser) {
      try { await signInAnonymously(fb.auth); } catch(e) { console.error(e); }
    }
  }

  function bind(){
    $("#search").addEventListener("input",e=>{state.search=e.target.value.toLowerCase();renderProducts();});
    $("#sort").addEventListener("change",e=>{state.sort=e.target.value;renderProducts();});
    $("#closeModal").onclick=closeModal;
    $("#productModal").addEventListener("click",e=>{if(e.target.id==="productModal")closeModal();});
    $("#adminClose").onclick=closeAdmin;
    $("#authClose").onclick=()=>$("#authModal").classList.remove("open");
    $("#authForm").onsubmit=loginAdmin;
    $("#adminDrawer .admin-tabs").addEventListener("click",e=>{const b=e.target.closest("[data-admin-tab]");if(!b)return;state.adminTab=b.dataset.adminTab;renderAdmin();});
    $("#adminDrawer").addEventListener("input",e=>{if(e.target.id==="adminSearch"){state.adminSearch=e.target.value;renderAdmin();const input=$("#adminSearch");if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length);}}});
  }

  async function loadSettings(){
    try{
      const snap=await getDoc(doc(fb.db,"siteSettings","public"));
      state.settings=snap.exists()?snap.data():{};
      if(!Array.isArray(state.settings.promotions)) state.settings.promotions=[];
      if(state.settings.businessName) state.config.businessName=state.settings.businessName;
      if(state.settings.location){state.config.location=state.settings.location;$("#footerLocation").textContent=state.settings.location;}
      if(state.settings.whatsapp) state.config.whatsapp=state.settings.whatsapp;
      applyBranding(state.settings);
    }catch(e){ console.warn("No se pudo leer configuración pública",e); }
  }
  function applyFallbackBranding(){ applyBranding({}); }
  function applyBranding(s){
    const logo=s.logoUrl||"assets/brand/logo.png";
    $$(".logo,.footer-logo").forEach(i=>i.src=logo);
    const bg=s.backgroundUrl||"assets/brand/hero-background.png";
    const hero=$(".hero-card"); if(hero) hero.style.backgroundImage=`linear-gradient(90deg,#fff 0%,#fffdf4eF 45%,#fff5 100%),url("${bg}")`;
  }

  async function loadProducts(){
    try{
      const q=isAdmin()?collection(fb.db,"pinatas"):query(collection(fb.db,"pinatas"),where("status","==","published"));
      const snap=await getDocs(q);
      if(!snap.empty){ state.products=snap.docs.map(d=>({id:d.id,...d.data()})); }
      else if(isAdmin()) state.products=[];
      else state.products=Array.isArray(window.PINATAS_CATALOGO)?window.PINATAS_CATALOGO:[];
    }catch(e){
      console.error("No se pudo cargar catálogo",e);
      state.products=Array.isArray(window.PINATAS_CATALOGO)?window.PINATAS_CATALOGO:[];
      if(firebaseReady) toast("No se pudo leer Firebase; mostrando catálogo inicial");
    }
  }
  async function hydratePublicRatings(){
    if(!firebaseReady || state.admin || !state.products.length) return;
    const cacheKey="pc_rating_cache_v1";
    let cache={};
    try{cache=JSON.parse(localStorage.getItem(cacheKey)||"{}")}catch(_){}
    const now=Date.now();
    await Promise.all(state.products.filter(p=>p.status!=="hidden"&&p.status!=="draft").map(async p=>{
      const cached=cache[p.id];
      if(cached && now-cached.ts<120000){
        p.ratingAverage=Number(cached.average)||0;
        p.ratingCount=Number(cached.count)||0;
        return;
      }
      try{
        const rs=await getDocs(collection(fb.db,"pinatas",p.id,"ratings"));
        const vals=rs.docs.map(d=>Number(d.data().value)||0).filter(v=>v>=1&&v<=5);
        const average=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
        p.ratingAverage=average;
        p.ratingCount=vals.length;
        cache[p.id]={average,count:vals.length,ts:now};
      }catch(e){
        console.warn("No se pudieron cargar las valoraciones de",p.id,e);
      }
    }));
    try{localStorage.setItem(cacheKey,JSON.stringify(cache));}catch(_){}
  }
  function renderAll(){renderCategories();renderProducts();renderFeatured();renderPromotionBanner();renderAdmin();updateAdminButton();}
  function updateAdminButton(){const b=$(".head-link[onclick*=openAdmin]"); if(b) b.innerHTML=state.admin?"⚙ <span>Panel</span>":"⚙ <span>Administrar</span>";}
  function getVisibleProducts(){
    let list=state.products.filter(p=>p.status!=="hidden"&&p.status!=="draft");
    if(state.category!=="Todas")list=list.filter(p=>p.category===state.category);
    if(state.search)list=list.filter(p=>`${p.name} ${p.category} ${p.description} ${(p.tags||[]).join(" ")}`.toLowerCase().includes(state.search));
    if(state.sort==="priceLow")list.sort((a,b)=>a.price-b.price);
    if(state.sort==="priceHigh")list.sort((a,b)=>b.price-a.price);
    if(state.sort==="rating")list.sort((a,b)=>(b.ratingAverage??b.rating??0)-(a.ratingAverage??a.rating??0));
    if(state.sort==="featured")list.sort((a,b)=>Number(b.featured)-Number(a.featured));
    return list;
  }
  function renderCategories(){
    const cats=["Todas",...new Set(state.products.map(p=>p.category).filter(Boolean))];
    $("#categories").innerHTML=cats.map(c=>`<button class="cat ${state.category===c?"active":""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
    $("#categories").onclick=e=>{const b=e.target.closest("[data-cat]");if(!b)return;state.category=b.dataset.cat;renderCategories();renderProducts();};
  }
  function renderFeatured(){const list=state.products.filter(p=>p.status!=="hidden"&&p.status!=="draft"&&p.featured);$("#featuredProducts").innerHTML=list.length?list.map(card).join(""):`<div class="empty" style="grid-column:1/-1">Todavía no hay diseños destacados.</div>`;}
  function renderProducts(){const list=getVisibleProducts();$("#resultCount").textContent=`${list.length} diseño${list.length===1?"":"s"}`;$("#products").innerHTML=list.length?list.map(card).join(""):`<div class="empty" style="grid-column:1/-1">No encontramos piñatas con esos filtros. 🥺<br><br><button class="btn btn-yellow" onclick="App.clearFilters()">Ver todo</button></div>`;}
  function offerData(p){
    const base=Number(p.price)||0;
    let offer=Number(p.offerPrice);
    const discount=Number(p.discountPercent)||0;
    if(!(offer>0) && discount>0) offer=base*(1-discount/100);
    const active=p.offerEnabled && offer>0 && (!p.offerStart || Date.now()>=new Date(p.offerStart).getTime()) && (!p.offerEnd || Date.now()<=new Date(p.offerEnd).getTime());
    return {base,offer:Math.max(0,offer),discount:discount>0?Math.min(100,discount):0,active};
  }
  function priceHtml(p){
    const o=offerData(p);
    if(!o.active) return `<div class="product-price">$${money(o.base)} <small>MXN</small></div>`;
    const pct=o.discount || Math.max(1,Math.round((1-o.offer/o.base)*100));
    return `<div class="product-price offer"><span class="old-price">$${money(o.base)}</span> <span class="new-price">$${money(o.offer)}</span> <small>MXN</small><span class="discount-badge">-${pct}%</span></div>`;
  }
  function card(p){
    const fav=state.favorites.includes(p.id), count=Number(p.ratingCount)||0, avg=count>0?Number(p.ratingAverage??p.rating??0):0;
    return `<article class="product-card"><div class="product-image">${p.featured?`<span class="badge">DESTACADA</span>`:""}${offerData(p).active?`<span class="offer-badge">OFERTA</span>`:""}<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy"><button class="heart ${fav?"active":""}" onclick="App.toggleFavorite(event,'${p.id}')">${fav?"♥":"♡"}</button></div><div class="product-info"><p class="product-title">${esc(p.name)}</p><div class="rating">${stars(avg)} <span class="rating-value">${count?Number(avg).toFixed(1):"0.0"}</span> <span class="rating-count">(${count})</span></div><div class="product-desc">${esc(p.description)}</div>${priceHtml(p)}<div class="product-actions"><button onclick="App.openProduct('${p.id}')">Ver detalles</button><button class="dark" onclick="App.order('${p.id}')">Pedir</button></div></div></article>`;
  }
  function detailPriceHtml(p){
    const o=offerData(p);
    if(!o.active) return `<div class="detail-price">$${money(o.base)} MXN</div>`;
    const pct=o.discount || Math.max(1,Math.round((1-o.offer/o.base)*100));
    return `<div class="detail-price offer"><span class="old-price">$${money(o.base)}</span> <span class="new-price">$${money(o.offer)}</span> MXN <span class="discount-badge">-${pct}%</span></div>`;
  }

  async function openProduct(id){
    const p=state.products.find(x=>x.id===id);if(!p)return;
    const gallery=p.gallery?.length?p.gallery:[p.image];
    let comments=[], ratingData={average:(Number(p.ratingCount)||0)>0?Number(p.ratingAverage??p.rating??0):0,count:Number(p.ratingCount)||0}, myRating=0;
    if(firebaseReady){
      try{
        const cs=await getDocs(query(collection(fb.db,"pinatas",id,"comments"),orderBy("createdAt","desc")));comments=cs.docs.map(d=>({id:d.id,...d.data()}));
        const rs=await getDocs(collection(fb.db,"pinatas",id,"ratings"));
        if(!rs.empty){const vals=rs.docs.map(d=>Number(d.data().value)||0);ratingData={count:vals.length,average:vals.reduce((a,b)=>a+b,0)/vals.length}; const me=fb.auth.currentUser; if(me){const mine=rs.docs.find(d=>d.id===me.uid); myRating=mine?Number(mine.data().value)||0:0;}}
        p.ratingAverage=ratingData.average;p.ratingCount=ratingData.count;renderProducts();renderFeatured();
      }catch(e){console.warn("No se pudieron cargar opiniones",e);}
    }
    $("#modalContent").innerHTML=`<div class="detail"><div class="detail-gallery"><img id="detailMain" class="detail-main" src="${esc(gallery[0])}" alt="${esc(p.name)}"><div class="thumbs">${gallery.map((g,i)=>`<img class="thumb ${i===0?"selected":""}" src="${esc(g)}" onclick="App.selectImage(this,'${esc(g)}')">`).join("")}</div></div><div class="detail-content"><span class="pill">${esc(p.category)}</span><h2>${esc(p.name)}</h2><div class="rating">${stars(ratingData.average)} <span class="rating-value">${ratingData.count?ratingData.average.toFixed(1):"0.0"}</span> <span class="rating-count">· ${ratingData.count} valoración(es)</span></div>${detailPriceHtml(p)}<p style="color:#666;line-height:1.65">${esc(p.description)}</p><div class="specs"><div class="spec"><small>Medida</small><b>${esc(p.size||"A medida")}</b></div><div class="spec"><small>Categoría</small><b>${esc(p.category)}</b></div></div><div class="share-row"><button class="btn btn-primary" onclick="App.order('${p.id}')">💬 Pedir por WhatsApp</button><button class="btn btn-white" onclick="App.share('${p.id}')">🔗 Compartir</button><button class="btn btn-white" onclick="App.toggleFavorite(null,'${p.id}')">${state.favorites.includes(p.id)?"♥ Quitar favorito":"♡ Guardar"}</button></div><div class="comments"><h3>⭐ Opiniones</h3><div class="rating-picker" aria-label="Tu valoración">${[1,2,3,4,5].map(n=>`<button class="${n<=myRating?"selected":""}" onclick="App.rate('${p.id}',${n})">${n<=myRating?"★":"☆"}</button>`).join("")}</div>${comments.length?comments.map(c=>`<div class="comment"><b>${esc(c.name)}</b><small>${c.createdAt?.toDate?c.createdAt.toDate().toLocaleDateString("es-MX"):""} · ${c.stars} ⭐</small><p>${esc(c.text)}</p></div>`).join(""):`<p style="color:#888">Todavía no hay comentarios. ¡Sé el primero!</p>`}<div class="comment-form"><input id="commentName" placeholder="Tu nombre"><textarea id="commentText" placeholder="Escribe tu comentario..."></textarea><button class="btn btn-white" onclick="App.addComment('${p.id}')">Publicar opinión</button></div></div></div></div>`;
    $("#productModal").classList.add("open");history.replaceState(null,"",`#producto=${encodeURIComponent(id)}`);
  }
  function selectImage(el,src){$("#detailMain").src=src;$(".thumb").forEach(t=>t.classList.remove("selected"));el.classList.add("selected");}
  function closeModal(){$("#productModal").classList.remove("open");history.replaceState(null,"",location.pathname+location.search);}
  function toggleFavorite(e,id){if(e)e.stopPropagation();state.favorites=state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[...state.favorites,id];localStorage.setItem("pc_favorites",JSON.stringify(state.favorites));renderProducts();if($("#productModal").classList.contains("open"))openProduct(id);toast(state.favorites.includes(id)?"Guardada en favoritos ❤️":"Quitada de favoritos");}

  async function ensureAnonymous(){if(!firebaseReady)return null;if(!fb.auth.currentUser)await signInAnonymously(fb.auth);return fb.auth.currentUser;}
  async function rate(id,value){
    if(!firebaseReady)return toast("Conecta Firebase para valorar");
    try{const u=await ensureAnonymous();await setDoc(doc(fb.db,"pinatas",id,"ratings",u.uid),{uid:u.uid,value,updatedAt:serverTimestamp()},{merge:true});
      const rs=await getDocs(collection(fb.db,"pinatas",id,"ratings"));
      const vals=rs.docs.map(d=>Number(d.data().value)||0).filter(v=>v>=1&&v<=5);
      const average=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
      const p=state.products.find(x=>x.id===id);
      if(p){p.ratingAverage=average;p.ratingCount=vals.length;}
      try{
        const cache=JSON.parse(localStorage.getItem("pc_rating_cache_v1")||"{}");
        cache[id]={average,count:vals.length,ts:Date.now()};
        localStorage.setItem("pc_rating_cache_v1",JSON.stringify(cache));
      }catch(_){}
      // El voto público se guarda únicamente en la subcolección ratings.
      // No intentamos modificar el documento principal de la piñata porque las reglas
      // de Firestore reservan ese permiso para el administrador.
      toast("¡Gracias por valorar! ⭐");renderProducts();renderFeatured();await openProduct(id);}
    catch(e){console.error(e);toast("No se pudo guardar tu valoración");}
  }
  async function addComment(id){
    const name=$("#commentName").value.trim()||"Visitante", text=$("#commentText").value.trim();if(!text)return toast("Escribe un comentario");
    if(!firebaseReady)return toast("Conecta Firebase para comentar");
    try{const u=await ensureAnonymous();await addDoc(collection(fb.db,"pinatas",id,"comments"),{uid:u.uid,name:name.slice(0,80),text:text.slice(0,1000),stars:5,createdAt:serverTimestamp()});toast("Comentario publicado 💬");await openProduct(id);}catch(e){console.error(e);toast("No se pudo publicar el comentario");}
  }
  async function order(id){
    const p=state.products.find(x=>x.id===id);if(!p)return;
    const o=offerData(p), shownPrice=o.active?o.offer:o.base; const message=`Hola 👋, me interesa la piñata "${p.name}" de $${money(shownPrice)} MXN${o.active?" (precio de oferta)":""}. ¿Me pueden dar información y disponibilidad?`;
    if(firebaseReady){try{const u=await ensureAnonymous();await addDoc(collection(fb.db,"pinatasOrders"),{uid:u.uid,pinataId:p.id,pinataName:p.name,name:"Cliente web",message,createdAt:serverTimestamp(),status:"new"});}catch(e){console.warn("No se pudo registrar solicitud",e);}}
    window.open(`https://wa.me/${state.config.whatsapp}?text=${encodeURIComponent(message)}`,"_blank");
  }
  async function share(id){const p=state.products.find(x=>x.id===id),url=`${location.origin}${location.pathname}#producto=${encodeURIComponent(id)}`;if(navigator.share)await navigator.share({title:p.name,text:`Mira esta piñata de ${state.config.businessName}`,url});else{await navigator.clipboard.writeText(url);toast("Enlace copiado 🔗");}}
  async function shareShop(){const url=location.href.split("#")[0];if(navigator.share)await navigator.share({title:state.config.businessName,text:"Mira nuestro catálogo de piñatas 🪅",url});else{await navigator.clipboard.writeText(url);toast("Enlace del catálogo copiado 🔗");}}
  function clearFilters(){state.category="Todas";state.search="";$("#search").value="";renderCategories();renderProducts();}

  function openAdmin(){if(!firebaseReady)return toast("Primero conecta Firebase en data/firebase-config.js");if(state.admin){$("#adminDrawer").classList.add("open");renderAdmin();}else{$("#authModal").classList.add("open");$("#authEmail").focus();}}
  function closeAdmin(){$("#adminDrawer").classList.remove("open");}
  async function loginAdmin(e){
    e.preventDefault();$("#authError").textContent="";
    try{await signInWithEmailAndPassword(fb.auth,$("#authEmail").value.trim(),$("#authPassword").value);if(fb.auth.currentUser.uid!==window.PINATAS_ADMIN_UID)throw new Error("Esta cuenta no está autorizada como administrador.");$("#authModal").classList.remove("open");$("#adminDrawer").classList.add("open");state.adminTab="products";await loadProducts();renderAll();toast("Sesión de administrador iniciada");}
    catch(e){console.error(e);$("#authError").textContent=e.message.includes("authorized")?e.message:"Correo o contraseña incorrectos.";try{await signOut(fb.auth);await signInAnonymously(fb.auth);}catch(_){} }
  }
  async function logoutAdmin(){try{await signOut(fb.auth);await signInAnonymously(fb.auth);}catch(e){console.error(e)}state.admin=false;closeAdmin();await loadProducts();renderAll();}

  function renderAdmin(){
    if(!state.admin){$("#adminContent").innerHTML=`<div class="empty">Inicia sesión como administrador para gestionar el sitio.</div>`;return;}
    $("#adminProductsTab").classList.toggle("active",state.adminTab==="products");$("#adminNewTab").classList.toggle("active",state.adminTab==="new");$("#adminPromotionsTab").classList.toggle("active",state.adminTab==="promotions");$("#adminToolsTab").classList.toggle("active",state.adminTab==="tools");
    $("#adminContent").innerHTML=state.adminTab==="products"?adminProductsView():state.adminTab==="new"?editorView(state.editingProduct||{}):state.adminTab==="promotions"?promotionsView():toolsView();
    if(state.adminTab==="products"){$("#adminLogout").onclick=logoutAdmin;}
    if(state.adminTab==="new")bindEditor();
    if(state.adminTab==="promotions")bindPromotions();
    if(state.adminTab==="tools")bindTools();
  }
  function adminProductsView(){
    const q=(state.adminSearch||"").toLowerCase(),list=state.products.filter(p=>`${p.name} ${p.category} ${(p.tags||[]).join(" ")}`.toLowerCase().includes(q));
    return `<div class="admin-stats"><div class="admin-stat"><b>${state.products.length}</b><span>Piñatas</span></div><div class="admin-stat"><b>${state.products.filter(p=>p.status==="published").length}</b><span>Publicadas</span></div><div class="admin-stat"><b>${state.products.filter(p=>p.featured).length}</b><span>Destacadas</span></div></div><div style="display:flex;gap:8px;margin-bottom:10px"><input id="adminSearch" class="filter" style="width:100%" value="${esc(state.adminSearch)}" placeholder="Buscar piñata..."><button class="btn btn-yellow" onclick="App.newProduct()">＋ Nueva</button></div><div class="admin-list">${list.map(p=>`<div class="admin-row"><img src="${esc(p.image)}"><div><strong>${esc(p.name)}</strong><br><small>$${money(p.price)} · ${esc(p.category)} · ${esc(p.status||"published")}</small></div><div class="admin-actions"><button onclick="App.editProduct('${p.id}')">✏️ Editar</button><button onclick="App.duplicateProduct('${p.id}')">📄 Duplicar</button><button onclick="App.toggleHidden('${p.id}')">${p.status==="hidden"?"👁️ Mostrar":"🙈 Ocultar"}</button><button onclick="App.deleteProduct('${p.id}')">🗑️ Eliminar</button></div></div>`).join("")||`<div class="empty">No hay piñatas todavía.</div>`}</div><button class="btn btn-white full" id="adminLogout" style="margin-top:12px">Cerrar sesión</button>`;
  }
  function editorView(p={}){return `<form id="productForm" class="form-grid"><input id="editId" type="hidden" value="${esc(p.id||"")}"><input id="editName" value="${esc(p.name||"")}" placeholder="Nombre *" required><input id="editPrice" type="number" min="0" value="${p.price??""}" placeholder="Precio MXN *" required><input id="editCategory" value="${esc(p.category||"Personalizada")}" placeholder="Categoría"><input id="editSize" value="${esc(p.size||"A medida")}" placeholder="Medida"><select id="editStatus"><option value="published" ${(p.status||"published")==="published"?"selected":""}>Publicada</option><option value="draft" ${p.status==="draft"?"selected":""}>Borrador</option><option value="hidden" ${p.status==="hidden"?"selected":""}>Oculta</option></select><label style="display:flex;align-items:center;gap:7px"><input id="editFeatured" type="checkbox" ${p.featured?"checked":""}> Destacada</label><div class="offer-editor full"><b>🏷️ Oferta / descuento</b><div class="offer-grid"><label><input id="editOfferEnabled" type="checkbox" ${p.offerEnabled?"checked":""}> Activar oferta</label><label>Descuento %<input id="editDiscount" type="number" min="0" max="100" step="1" value="${p.discountPercent??""}" placeholder="Ej. 15"></label><label>Precio especial<input id="editOfferPrice" type="number" min="0" step="1" value="${p.offerPrice??""}" placeholder="Opcional"></label><label>Inicia<input id="editOfferStart" type="datetime-local" value="${p.offerStart??""}"></label><label>Termina<input id="editOfferEnd" type="datetime-local" value="${p.offerEnd??""}"></label></div><small>Si activas la oferta puedes usar porcentaje o precio especial. La tarjeta mostrará el precio anterior y el nuevo.</small></div><textarea id="editDesc" class="full" placeholder="Descripción">${esc(p.description||"")}</textarea><input id="editTags" class="full" value="${esc((p.tags||[]).join(", "))}" placeholder="Etiquetas separadas por coma"><label class="upload full">📸 Fotos de la piñata<input id="productImages" type="file" accept="image/*" multiple><small>Las fotos se subirán directamente a Firebase Storage.</small></label><div id="editPreview" class="preview-grid full">${(p.gallery||[p.image]).filter(Boolean).map(g=>`<img src="${esc(g)}">`).join("")}</div><button type="submit" class="btn btn-primary full">💾 Guardar piñata</button><button type="button" id="cancelEdit" class="btn btn-white full">Cancelar</button></form>`;}
  function newProduct(){state.editingProduct={};state.adminTab="new";renderAdmin();}
  function editProduct(id){state.editingProduct={...state.products.find(x=>x.id===id)};state.adminTab="new";renderAdmin();}
  function bindEditor(){$("#cancelEdit").onclick=()=>{state.editingProduct=null;state.adminTab="products";renderAdmin()};$("#productImages").onchange=previewFiles;$("#productForm").onsubmit=saveProduct;}
  function previewFiles(){const box=$("#editPreview");box.innerHTML="";[...this.files].forEach(f=>{const r=new FileReader();r.onload=()=>box.insertAdjacentHTML("beforeend",`<img src="${r.result}">`);r.readAsDataURL(f);});}
  async function compressImage(file){const bitmap=await createImageBitmap(file),max=1800,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement("canvas");canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);return await new Promise(res=>canvas.toBlob(res,"image/webp",.86));}
  async function uploadProductImages(id,files){const urls=[];for(let i=0;i<files.length;i++){const blob=await compressImage(files[i]),path=`pinatas/products/${id}/${Date.now()}-${i}.webp`,r=ref(fb.storage,path);await uploadBytes(r,blob,{contentType:"image/webp",cacheControl:"public,max-age=31536000,immutable"});urls.push(await getDownloadURL(r));}return urls;}
  async function saveProduct(e){
    e.preventDefault();if(!isAdmin())return toast("Sesión de administrador requerida");
    const id=$("#editId").value||crypto.randomUUID(),old=state.products.find(p=>p.id===id),files=[...$("#productImages").files];
    try{
      let gallery=old?.gallery||[];if(files.length)gallery=await uploadProductImages(id,files);if(!gallery.length)return toast("Agrega al menos una fotografía");
      const data={name:$("#editName").value.trim(),price:Number($("#editPrice").value),category:$("#editCategory").value.trim()||"Personalizada",size:$("#editSize").value.trim()||"A medida",status:$("#editStatus").value,featured:$("#editFeatured").checked,offerEnabled:$("#editOfferEnabled").checked,discountPercent:Number($("#editDiscount").value)||0,offerPrice:Number($("#editOfferPrice").value)||0,offerStart:$("#editOfferStart").value||"",offerEnd:$("#editOfferEnd").value||"",description:$("#editDesc").value.trim(),tags:$("#editTags").value.split(",").map(x=>x.trim()).filter(Boolean),image:gallery[0],gallery,updatedAt:serverTimestamp(),ratingAverage:old?.ratingAverage??0,ratingCount:old?.ratingCount??0};
      await setDoc(doc(fb.db,"pinatas",id),data,{merge:true});state.editingProduct=null;state.adminTab="products";await loadProducts();renderAll();toast(old?"Piñata actualizada ✨":"Piñata publicada 🪅");
    }catch(e){console.error(e);toast("No se pudo guardar la piñata");}
  }
  async function duplicateProduct(id){const p=state.products.find(x=>x.id===id);if(!p)return;state.editingProduct={...p,id:"",name:p.name+" (copia)",status:"draft"};state.adminTab="new";renderAdmin();toast("Copia preparada como borrador");}
  async function toggleHidden(id){const p=state.products.find(x=>x.id===id);if(!p||!isAdmin())return;try{await updateDoc(doc(fb.db,"pinatas",id),{status:p.status==="hidden"?"published":"hidden",updatedAt:serverTimestamp()});await loadProducts();renderAll();toast("Estado actualizado");}catch(e){console.error(e);toast("No se pudo cambiar el estado");}}
  async function deleteProduct(id){const p=state.products.find(x=>x.id===id);if(!p||!confirm(`¿Eliminar "${p.name}"? Esta acción elimina el registro del catálogo.`))return;try{await deleteDoc(doc(fb.db,"pinatas",id));state.products=state.products.filter(x=>x.id!==id);renderAll();toast("Piñata eliminada");}catch(e){console.error(e);toast("No se pudo eliminar");}}

  function promotionsView(){
    const promotions=Array.isArray(state.settings?.promotions)?state.settings.promotions:[];
    return `<div class="admin-stat"><b>🏷️ Promociones generales</b><span>Estas promociones pueden aparecer en la página principal. Puedes crear, activar o eliminar avisos sin tocar cada piñata.</span></div><form id="promotionForm" class="form-grid" style="margin-top:10px"><input id="promoTitle" placeholder="Título de la promoción *" required><input id="promoText" placeholder="Texto corto / beneficio" required><input id="promoBadge" placeholder="Etiqueta (ej. 15% OFF)" value="OFERTA"><input id="promoLink" placeholder="Enlace o #catalogo" value="#catalogo"><label><input id="promoActive" type="checkbox" checked> Mostrar en la página</label><button class="btn btn-primary full" type="submit">＋ Crear promoción</button></form><div class="promotion-list" style="margin-top:14px">${promotions.map((x,i)=>`<div class="promotion-row"><div><b>${esc(x.title)}</b><small>${esc(x.text)} · ${x.active?"Activa":"Oculta"}</small></div><div><button class="admin-actions-btn" onclick="App.togglePromotion(${i})">${x.active?"🙈 Ocultar":"👁️ Mostrar"}</button><button class="admin-actions-btn" onclick="App.deletePromotion(${i})">🗑️</button></div></div>`).join("")||`<div class="empty">Todavía no hay promociones generales.</div>`}</div>`;
  }
  function bindPromotions(){
    $("#promotionForm").onsubmit=async e=>{e.preventDefault();const promotions=Array.isArray(state.settings?.promotions)?[...state.settings.promotions]:[];promotions.push({id:crypto.randomUUID(),title:$("#promoTitle").value.trim(),text:$("#promoText").value.trim(),badge:$("#promoBadge").value.trim()||"OFERTA",link:$("#promoLink").value.trim()||"#catalogo",active:$("#promoActive").checked,createdAt:Date.now()});await savePromotions(promotions);e.target.reset();$("#promoBadge").value="OFERTA";$("#promoLink").value="#catalogo";$("#promoActive").checked=true;};
  }
  async function savePromotions(promotions){try{await setDoc(doc(fb.db,"siteSettings","public"),{promotions,updatedAt:serverTimestamp()},{merge:true});state.settings={...(state.settings||{}),promotions};renderAdmin();renderPromotionBanner();toast("Promoción actualizada ✨");}catch(e){console.error(e);toast("No se pudo guardar la promoción");}}
  async function togglePromotion(i){const promotions=[...(state.settings?.promotions||[])];if(!promotions[i])return;promotions[i]={...promotions[i],active:!promotions[i].active};await savePromotions(promotions);}
  async function deletePromotion(i){const promotions=[...(state.settings?.promotions||[])];if(!promotions[i]||!confirm("¿Eliminar esta promoción?"))return;promotions.splice(i,1);await savePromotions(promotions);}
  function renderPromotionBanner(){
    const box=$("#promotionBanner");if(!box)return;const list=(state.settings?.promotions||[]).filter(x=>x.active);box.innerHTML=list.length?list.map(x=>`<a class="promotion-banner" href="${esc(x.link||"#catalogo")}"><span class="promotion-badge">${esc(x.badge||"OFERTA")}</span><span><b>${esc(x.title)}</b><small>${esc(x.text)}</small></span><span class="promotion-arrow">→</span></a>`).join(""):"";box.style.display=list.length?"grid":"none";
  }
  async function syncAllRatings(){
    if(!isAdmin()||!firebaseReady)return;
    try{
      for(const p of state.products){
        const rs=await getDocs(collection(fb.db,"pinatas",p.id,"ratings"));
        const vals=rs.docs.map(d=>Number(d.data().value)||0).filter(v=>v>=1&&v<=5);
        const average=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
        if((Number(p.ratingCount)||0)!==vals.length || Math.abs(Number(p.ratingAverage||0)-average)>0.001){
          await updateDoc(doc(fb.db,"pinatas",p.id),{ratingAverage:average,ratingCount:vals.length,updatedAt:serverTimestamp()});
        }
        p.ratingAverage=average;p.ratingCount=vals.length;
      }
    }catch(e){console.warn("No se pudieron sincronizar todas las valoraciones",e);}
  }
  function toolsView(){return `<div style="display:grid;gap:10px"><div class="admin-stat"><b>🚀 Publicación</b><span>La web se puede alojar en GitHub Pages. Firebase guarda contenido e imágenes.</span></div><div class="admin-stat"><b>⭐ Valoraciones</b><span>Sincroniza el promedio y número de valoraciones de las piñatas para mostrarlos también en las tarjetas.</span><br><button class="btn btn-white" style="margin-top:8px" id="syncRatings">Sincronizar valoraciones</button></div><div class="admin-stat"><b>📦 Catálogo inicial</b><span>Sube las 10 piñatas que ya trae el diseño a Firestore.</span><br><button class="btn btn-white" style="margin-top:8px" id="seedCatalog">Importar catálogo inicial</button></div><div class="admin-stat"><b>🖼️ Imagen de fondo</b><span>Sube el fondo actual al Storage.</span><br><input id="backgroundFile" type="file" accept="image/*" style="margin-top:8px"><button class="btn btn-white" style="margin-top:8px" id="uploadBackground">Guardar fondo</button></div><div class="admin-stat"><b>🏷️ Logo</b><span>Sube el logo actual al Storage.</span><br><input id="logoFile" type="file" accept="image/*" style="margin-top:8px"><button class="btn btn-white" style="margin-top:8px" id="uploadLogo">Guardar logo</button></div><div class="admin-stat"><b>📱 WhatsApp</b><span>Número actual: ${esc(state.config.whatsapp||"No configurado")}</span></div></div>`;}
  function bindTools(){$("#seedCatalog").onclick=seedCatalog;$("#syncRatings").onclick=async()=>{await syncAllRatings();renderProducts();renderFeatured();toast("Valoraciones sincronizadas ⭐")};$("#uploadBackground").onclick=()=>uploadBrandAsset("backgroundFile","backgrounds","backgroundUrl");$("#uploadLogo").onclick=()=>uploadBrandAsset("logoFile","logo","logoUrl");}
  async function seedCatalog(){if(!isAdmin())return;const list=window.PINATAS_CATALOGO||[];try{for(const p of list){const refDoc=doc(fb.db,"pinatas",p.id);const snap=await getDoc(refDoc);if(snap.exists())continue;await setDoc(refDoc,{...p,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});}await loadProducts();renderAll();toast("Catálogo inicial importado");}catch(e){console.error(e);toast("No se pudo importar el catálogo");}}
  async function uploadBrandAsset(inputId,folder,field){const file=$("#"+inputId).files[0];if(!file)return toast("Selecciona una imagen");try{const blob=await compressImage(file),r=ref(fb.storage,`pinatas/${folder}/site-${Date.now()}.webp`);await uploadBytes(r,blob,{contentType:"image/webp",cacheControl:"public,max-age=31536000,immutable"});const url=await getDownloadURL(r);await setDoc(doc(fb.db,"siteSettings","public"),{[field]:url,updatedAt:serverTimestamp()},{merge:true});await loadSettings();toast("Imagen actualizada ✨");}catch(e){console.error(e);toast("No se pudo subir la imagen");}}

  function handleHash(){const m=location.hash.match(/producto=([^&]+)/);if(m){const id=decodeURIComponent(m[1]);if(state.products.some(p=>p.id===id))openProduct(id);}}
  return {init,openProduct,selectImage,toggleFavorite,rate,addComment,order,share,shareShop,clearFilters,openAdmin,closeAdmin,renderAdmin,newProduct,editProduct,duplicateProduct,toggleHidden,deleteProduct,togglePromotion,deletePromotion};
})();
window.App=App;
document.addEventListener("DOMContentLoaded",()=>App.init());
