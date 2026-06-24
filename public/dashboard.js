"use strict";

const MEAL_LABELS = {
    breakfast: "Colazione",
    lunch: "Pranzo",
    dinner: "Cena",
    snack: "Spuntino",
    other: "Altro",
};
const DATE_FMT = new Intl.DateTimeFormat("it-IT", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
});

let currentDate = null; // resolved YYYY-MM-DD once a day has loaded

const $ = (id) => document.getElementById(id);
const show = (id, on) => $(id).toggleAttribute("hidden", !on);

function el(tag, props, children) {
    const n = document.createElement(tag);
    if (props) for (const k in props) {
        if (k === "class") n.className = props[k];
        else if (k === "text") n.textContent = props[k];
        else n.setAttribute(k, props[k]);
    }
    for (const c of children || []) n.appendChild(c);
    return n;
}

function fmt(n) {
    const r = Math.round(Number(n) * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

async function api(path, opts) {
    const res = await fetch(path, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        ...opts,
    });
    return res;
}

function shiftDate(date, delta) {
    const [y, m, d] = date.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + delta);
    return dt.toISOString().slice(0, 10);
}

// ---- views ----

function showLogin() {
    show("loading", false);
    show("topbar", false);
    show("app", false);
    show("login", true);
    $("email").focus();
}

async function loadDay(date) {
    show("loading", true);
    show("login", false);
    const res = await api(`/api/dashboard/day/${date}`);
    if (res.status === 401) return showLogin();
    if (!res.ok) {
        show("loading", false);
        $("dateLabel").textContent = "errore di caricamento";
        return;
    }
    const view = await res.json();
    currentDate = view.date;
    render(view);
}

function render(view) {
    show("loading", false);
    show("topbar", true);
    show("login", false);
    show("app", true);

    const [y, m, d] = view.date.split("-").map(Number);
    $("dateLabel").textContent = DATE_FMT.format(new Date(Date.UTC(y, m - 1, d, 12)));

    renderSummary(view);
    renderChart(view.meals);
    renderMeals(view.meals);

    const isEmpty = view.meals.length === 0;
    show("empty", isEmpty);
    show("chart", !isEmpty);
    $("meals").toggleAttribute("hidden", isEmpty);
}

function metric(label, value, unit, goal, cls) {
    const kids = [
        el("div", { class: "label", text: label }),
        el("div", { class: "value" }, [
            document.createTextNode(value),
            el("span", { class: "unit", text: unit ? " " + unit : "" }),
        ]),
    ];
    if (goal != null) kids.push(el("div", { class: "goal", text: `obiettivo ${fmt(goal)}` }));
    return el("div", { class: "metric" + (cls ? " " + cls : "") }, kids);
}

function renderSummary(view) {
    const t = view.total;
    const g = view.goals || {};
    const box = $("summary");
    box.replaceChildren(
        metric("Calorie", fmt(t.calories), "kcal", g.calories, null),
        metric("Proteine", fmt(t.protein_g), "g", g.protein_g, null),
        metric("Carboidrati", fmt(t.carbs_g), "g", g.carbs_g, null),
        metric("Grassi", fmt(t.fat_g), "g", g.fat_g, null),
        metric("Fibra", fmt(t.fiber_g), "g", null, "fiber"),
    );
    if (view.water_ml > 0 || g.water_ml != null) {
        box.appendChild(metric("Acqua", fmt(view.water_ml), "ml", g.water_ml, null));
    }
}

function renderChart(meals) {
    const box = $("chart");
    box.replaceChildren();
    const max = Math.max(1, ...meals.map((mg) => mg.subtotal.calories));
    for (const mg of meals) {
        const h = Math.round((mg.subtotal.calories / max) * 100);
        box.appendChild(
            el("div", { class: "bar" }, [
                el("div", { class: "bval", text: String(Math.round(mg.subtotal.calories)) }),
                el("div", { class: "fill", style: `height:${h}%` }),
                el("div", { class: "blab", text: MEAL_LABELS[mg.meal_type] || mg.meal_type }),
            ]),
        );
    }
}

function row(cells, isSub) {
    const tr = el("tr", isSub ? { class: "sub" } : null);
    cells.forEach((c, i) => {
        const td = el("td", i === 5 ? { class: "fib" } : null, []);
        td.textContent = c;
        tr.appendChild(td);
    });
    return tr;
}

function headerRow() {
    const tr = el("tr");
    ["Alimento", "kcal", "P", "C", "G", "Fib"].forEach((h, i) => {
        const th = el("th", i === 5 ? { class: "fib" } : null);
        th.textContent = h;
        tr.appendChild(th);
    });
    return tr;
}

function renderMeals(meals) {
    const box = $("meals");
    box.replaceChildren();
    for (const mg of meals) {
        const head = el("thead", null, [headerRow()]);
        const body = el("tbody");
        for (const it of mg.items) {
            body.appendChild(
                row([
                    it.description,
                    fmt(it.calories),
                    fmt(it.protein_g),
                    fmt(it.carbs_g),
                    fmt(it.fat_g),
                    fmt(it.fiber_g),
                ]),
            );
        }
        const s = mg.subtotal;
        body.appendChild(
            row(["Subtotale", fmt(s.calories), fmt(s.protein_g), fmt(s.carbs_g), fmt(s.fat_g), fmt(s.fiber_g)], true),
        );

        const card = el("div", { class: "meal" }, [
            el("h2", null, [
                document.createTextNode(MEAL_LABELS[mg.meal_type] || mg.meal_type),
                el("span", { class: "kcal", text: `${Math.round(s.calories)} kcal` }),
            ]),
            el("table", null, [head, body]),
        ]);
        box.appendChild(card);
    }
}

// ---- auth ----

async function doLogin() {
    const btn = $("signin");
    show("loginError", false);
    btn.disabled = true;
    try {
        const res = await api("/api/dashboard/login", {
            method: "POST",
            body: JSON.stringify({
                email: $("email").value,
                password: $("password").value,
            }),
        });
        if (res.ok) {
            $("password").value = "";
            await loadDay("today");
        } else if (res.status === 429) {
            showError("Troppi tentativi. Riprova tra qualche minuto.");
        } else {
            showError("Credenziali non valide.");
        }
    } catch {
        showError("Errore di rete. Riprova.");
    } finally {
        btn.disabled = false;
    }
}

function showError(msg) {
    const e = $("loginError");
    e.textContent = msg;
    show("loginError", true);
}

async function doLogout() {
    await api("/api/dashboard/logout", { method: "POST" });
    currentDate = null;
    showLogin();
}

// ---- wiring ----

function init() {
    $("signin").addEventListener("click", doLogin);
    $("password").addEventListener("keydown", (e) => {
        if (e.key === "Enter") doLogin();
    });
    $("logout").addEventListener("click", doLogout);
    $("prev").addEventListener("click", () => currentDate && loadDay(shiftDate(currentDate, -1)));
    $("next").addEventListener("click", () => currentDate && loadDay(shiftDate(currentDate, 1)));
    $("today").addEventListener("click", () => loadDay("today"));

    api("/api/dashboard/session")
        .then((r) => r.json())
        .then((s) => (s.authenticated ? loadDay("today") : showLogin()))
        .catch(showLogin);

    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
}

init();
