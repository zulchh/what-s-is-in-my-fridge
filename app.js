"use strict";

/* ============================================================
   What's in My Fridge?
   - ingredients: arreglo de strings que escribe el usuario
   - recipes:     arreglo de objetos cargado desde recipes.json
   - favorites:   Set con ids de recetas
   ============================================================ */

const LS_INGREDIENTS = "wimf:ingredients";
const LS_FAVORITES = "wimf:favorites";

const COMMON = ["huevo", "leche", "queso", "jitomate", "cebolla", "ajo", "pollo", "arroz", "pasta", "papa", "tortilla", "aguacate"];

const state = {
  recipes: [],
  ingredients: readStorage(LS_INGREDIENTS, []),
  favorites: new Set(readStorage(LS_FAVORITES, [])),
  filter: "some",
  category: "all",
  openId: null,
};

/* ---------- Utilidades ---------- */

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* modo privado o almacenamiento lleno: la app sigue funcionando */
  }
}

// "Jitomate " -> "jitomate", "Champiñón" -> "champinon"
function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ñ/g, "n")
    .trim();
}

const $ = (selector) => document.querySelector(selector);

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (key === "text") node.textContent = value;
    else if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  });
  children.forEach((child) => node.append(child));
  return node;
}

/* ---------- Lógica de coincidencias ---------- */

const STOPWORDS = ["de", "del", "la", "el", "para", "con", "en"];

function tokens(text) {
  return normalize(text)
    .split(/\s+/)
    .filter((word) => word && !STOPWORDS.includes(word));
}

// Dos palabras son iguales si coinciden o solo cambia el plural (huevo/huevos, champiñón/champiñones).
function sameWord(a, b) {
  return a === b || a + "s" === b || b + "s" === a || a + "es" === b || b + "es" === a;
}

// Todas las palabras de "small" aparecen en "big".
function containsWords(big, small) {
  return small.length > 0 && small.every((word) => big.some((other) => sameWord(word, other)));
}

// Compara lo que tienes (have) con lo que pide la receta (need) por palabras completas:
// "huevos" coincide con "huevo" y "queso" con "queso fresco",
// pero "sal" NO coincide con "salsa verde" (a diferencia de un includes() sobre el texto).
function isMatch(have, need) {
  const a = tokens(have);
  const b = tokens(need);
  return containsWords(b, a) || containsWords(a, b);
}

function analyze(recipe) {
  const have = state.ingredients.map(normalize);
  const needed = recipe.ingredients.filter((ing) => !ing.basic);

  const owned = needed.filter((ing) => have.some((h) => isMatch(h, normalize(ing.name))));
  const missing = needed.filter((ing) => !owned.includes(ing));

  return {
    owned,
    missing,
    total: needed.length,
    ratio: needed.length ? owned.length / needed.length : 0,
  };
}

function ownsIngredient(ing) {
  const need = normalize(ing.name);
  return state.ingredients.some((item) => isMatch(normalize(item), need));
}

function getVisibleRecipes() {
  const hasIngredients = state.ingredients.length > 0;

  return state.recipes
    .map((recipe) => ({ recipe, info: analyze(recipe) }))
    .filter(({ recipe, info }) => {
      if (state.category !== "all" && recipe.category !== state.category) return false;

      switch (state.filter) {
        case "favs":
          return state.favorites.has(recipe.id);
        case "all":
          return true;
        case "ready":
          return hasIngredients && info.missing.length === 0;
        case "almost":
          return hasIngredients && info.owned.length > 0 && info.missing.length >= 1 && info.missing.length <= 2;
        case "some":
        default:
          // sin ingredientes no hay nada que filtrar: mostramos todo
          return hasIngredients ? info.owned.length > 0 : true;
      }
    })
    .sort((a, b) => b.info.ratio - a.info.ratio || a.info.missing.length - b.info.missing.length || a.recipe.time - b.recipe.time);
}

/* ---------- Ingredientes ---------- */

function addIngredient(raw) {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return;

  const exists = state.ingredients.some((item) => normalize(item) === normalize(name));
  if (!exists) {
    state.ingredients.push(name);
    writeStorage(LS_INGREDIENTS, state.ingredients);
  }
  render();
}

function removeIngredient(name) {
  state.ingredients = state.ingredients.filter((item) => item !== name);
  writeStorage(LS_INGREDIENTS, state.ingredients);
  render();
}

function renderIngredients() {
  const list = $("#ingredient-list");
  list.replaceChildren();

  state.ingredients.forEach((name) => {
    const remove = el("button", { type: "button", "aria-label": `Quitar ${name}`, text: "✕" });
    remove.addEventListener("click", () => removeIngredient(name));
    list.append(el("li", { class: "chip" }, [el("span", { text: name }), remove]));
  });

  $("#clear-all").hidden = state.ingredients.length === 0;

  // atajos: se deshabilitan los que ya agregaste
  document.querySelectorAll("#quick-add button").forEach((btn) => {
    btn.disabled = state.ingredients.some((item) => normalize(item) === normalize(btn.dataset.name));
  });
}

/* ---------- Favoritas ---------- */

function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  writeStorage(LS_FAVORITES, [...state.favorites]);
  render();
}

/* ---------- Tarjetas ---------- */

function photoUrl(recipe) {
  if (recipe.image) return recipe.image;
  return `https://loremflickr.com/640/420/${encodeURIComponent(recipe.photo)},food?lock=${recipe.id}`;
}

// Foto con emoji de respaldo si no hay internet o la imagen falla.
function buildMedia(recipe, container) {
  const fallback = el("div", { class: "fallback-emoji", "aria-hidden": "true", text: recipe.emoji });
  const img = el("img", { src: photoUrl(recipe), alt: recipe.name, loading: "lazy" });
  img.addEventListener("error", () => img.remove());
  container.append(fallback, img);
}

function badgeFor(info) {
  if (state.ingredients.length === 0) return null;
  const text = `${info.owned.length}/${info.total} ingredientes`;
  let kind = "some";
  if (info.missing.length === 0) kind = "ready";
  else if (info.missing.length <= 2 && info.owned.length > 0) kind = "almost";
  return el("span", { class: `badge ${kind}`, text: kind === "ready" ? "✓ Lista para cocinar" : text });
}

function buildCard({ recipe, info }) {
  const card = el("article", { class: "card", tabindex: "0", role: "button", "aria-label": `Ver receta: ${recipe.name}` });

  const media = el("div", { class: "card-media" });
  buildMedia(recipe, media);

  const fav = el("button", {
    class: "fav-btn",
    type: "button",
    "aria-pressed": String(state.favorites.has(recipe.id)),
    "aria-label": state.favorites.has(recipe.id) ? "Quitar de favoritas" : "Guardar en favoritas",
    text: state.favorites.has(recipe.id) ? "♥" : "♡",
  });
  fav.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavorite(recipe.id);
  });
  media.append(fav);

  const badge = badgeFor(info);
  if (badge) media.append(badge);

  const body = el("div", { class: "card-body" }, [
    el("h2", { text: recipe.name }),
    el("p", { class: "meta", text: `${recipe.time} min · ${recipe.difficulty} · ${recipe.servings} ${recipe.servings === 1 ? "porción" : "porciones"}` }),
  ]);

  if (state.ingredients.length > 0) {
    if (info.missing.length === 0) {
      body.append(el("p", { class: "have-all", text: "Tienes todo lo necesario" }));
    } else {
      const names = info.missing.map((ing) => ing.name).join(", ");
      body.append(el("p", { class: "missing" }, [el("strong", { text: "Te falta: " }), document.createTextNode(names)]));
    }
  }

  card.append(media, body);
  card.addEventListener("click", () => openRecipe(recipe.id));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openRecipe(recipe.id);
    }
  });
  return card;
}

function renderRecipes() {
  const grid = $("#recipe-grid");
  const results = getVisibleRecipes();
  grid.replaceChildren(...results.map(buildCard));

  // mensaje de resultados
  const info = $("#results-info");
  if (state.filter === "favs") info.textContent = `${results.length} ${results.length === 1 ? "receta favorita" : "recetas favoritas"}`;
  else if (state.ingredients.length === 0) info.textContent = "Agrega ingredientes para ver qué puedes cocinar. Mientras tanto, estas son todas las recetas.";
  else info.textContent = `${results.length} ${results.length === 1 ? "receta encontrada" : "recetas encontradas"}, ordenadas por coincidencia`;

  // estado vacío
  const empty = $("#empty");
  empty.hidden = results.length > 0;
  if (!empty.hidden) {
    const messages = {
      favs: ["Aún no tienes favoritas", "Toca el corazón ♡ de cualquier receta para guardarla aquí."],
      ready: ["Todavía no hay recetas completas", "Prueba con “Faltan 1–2” o agrega más ingredientes."],
      almost: ["Nada a un paso de estar lista", "Agrega más ingredientes o revisa “Con coincidencias”."],
      some: ["Sin coincidencias", "Ninguna receta usa esos ingredientes. Prueba con otros o mira “Todas”."],
      all: ["Sin resultados", "Cambia la categoría para ver más recetas."],
    };
    const [title, text] = messages[state.filter] || messages.all;
    $("#empty-title").textContent = title;
    $("#empty-text").textContent = text;
  }
}

/* ---------- Detalle (diálogo) ---------- */

function openRecipe(id) {
  const recipe = state.recipes.find((item) => item.id === id);
  if (!recipe) return;
  state.openId = id;
  renderDialog();
  const dialog = $("#recipe-dialog");
  if (!dialog.open) dialog.showModal();
}

function renderDialog() {
  const recipe = state.recipes.find((item) => item.id === state.openId);
  if (!recipe) return;

  const media = $("#dlg-media");
  media.replaceChildren();
  buildMedia(recipe, media);

  $("#dlg-cat").textContent = recipe.category;
  $("#dlg-title").textContent = recipe.name;
  $("#dlg-meta").textContent = `${recipe.time} min · ${recipe.difficulty} · rinde ${recipe.servings} ${recipe.servings === 1 ? "porción" : "porciones"}`;

  const isFav = state.favorites.has(recipe.id);
  const favBtn = $("#dlg-fav");
  favBtn.textContent = isFav ? "♥" : "♡";
  favBtn.setAttribute("aria-pressed", String(isFav));
  favBtn.setAttribute("aria-label", isFav ? "Quitar de favoritas" : "Guardar en favoritas");

  const ingList = $("#dlg-ingredients");
  ingList.replaceChildren();
  recipe.ingredients.forEach((ing) => {
    const hasIt = !ing.basic && ownsIngredient(ing);
    const cls = ing.basic ? "basic" : hasIt ? "has" : "lack";
    const mark = ing.basic ? "·" : hasIt ? "✓" : "✗";
    const li = el("li", { class: cls }, [el("span", { class: "mark", text: mark }), el("span", { text: ing.name })]);
    if (ing.basic) li.append(el("span", { class: "basic-tag", text: "básico" }));
    li.append(el("span", { class: "qty", text: ing.qty }));
    ingList.append(li);
  });

  const stepList = $("#dlg-steps");
  stepList.replaceChildren(...recipe.steps.map((step) => el("li", { text: step })));
}

/* ---------- Filtros y render general ---------- */

function renderFilters() {
  document.querySelectorAll("#match-filters .seg-btn").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.filter === state.filter));
  });
  $("#fav-count").textContent = state.favorites.size;
}

function render() {
  renderIngredients();
  renderFilters();
  renderRecipes();
  if ($("#recipe-dialog").open) renderDialog();
}

/* ---------- Inicio ---------- */

function setupStaticUI() {
  // formulario
  $("#ingredient-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("#ingredient-input");
    addIngredient(input.value);
    input.value = "";
    input.focus();
  });

  $("#clear-all").addEventListener("click", () => {
    state.ingredients = [];
    writeStorage(LS_INGREDIENTS, state.ingredients);
    render();
  });

  // atajos de ingredientes comunes
  const quick = $("#quick-add");
  COMMON.forEach((name) => {
    const btn = el("button", { type: "button", text: `+ ${name}` });
    btn.dataset.name = name;
    btn.addEventListener("click", () => addIngredient(name));
    quick.append(btn);
  });

  // filtros
  document.querySelectorAll("#match-filters .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filter = btn.dataset.filter;
      render();
    });
  });

  $("#category-filter").addEventListener("change", (event) => {
    state.category = event.target.value;
    render();
  });

  // diálogo
  const dialog = $("#recipe-dialog");
  $("#dlg-close").addEventListener("click", () => dialog.close());
  $("#dlg-fav").addEventListener("click", () => state.openId && toggleFavorite(state.openId));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close(); // clic en el fondo
  });
}

function populateFromRecipes() {
  // categorías únicas
  const categories = [...new Set(state.recipes.map((recipe) => recipe.category))].sort();
  const select = $("#category-filter");
  categories.forEach((cat) => select.append(el("option", { value: cat, text: cat })));

  // autocompletado con todos los ingredientes conocidos
  const known = new Set();
  state.recipes.forEach((recipe) => recipe.ingredients.filter((ing) => !ing.basic).forEach((ing) => known.add(ing.name)));
  const datalist = $("#ingredient-options");
  [...known].sort().forEach((name) => datalist.append(el("option", { value: name })));
}

async function init() {
  setupStaticUI();

  try {
    const response = await fetch("recipes.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.recipes = await response.json();
  } catch (error) {
    console.error("No se pudo cargar recipes.json:", error);
    $("#results-info").textContent = "";
    $("#empty").hidden = false;
    $("#empty-title").textContent = "No se pudo cargar recipes.json";
    $("#empty-text").textContent =
      "Abre el proyecto con un servidor local (por ejemplo: python3 -m http.server) y visita http://localhost:8000.";
    renderIngredients();
    renderFilters();
    return;
  }

  populateFromRecipes();
  render();
}

init();
