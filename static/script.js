/* ===================================================================
   MAROOLI v3 — Full client engine
   Memory, web search, full-screen flowchart, history, dynamic colors,
   skeleton loading, keyboard shortcuts, smart routing
   =================================================================== */

(function () {
    "use strict";

    var $ = function (id) { return document.getElementById(id); };

    // ─── REFS ────────────────────────────────────────────────

    var landingScreen   = $("landing-screen"),
        chatScreen      = $("chat-screen"),
        flowScreen      = $("flowchart-screen"),
        cardReverse     = $("card-reverse"),
        cardSimulate    = $("card-simulate"),
        backBtn         = $("back-btn"),
        headerModeTag   = $("header-mode-tag"),
        headerTitle     = $("header-title"),
        chatBody        = $("chat-body"),
        chatMessages    = $("chat-messages"),
        chatInput       = $("chat-input"),
        sendBtn         = $("send-btn"),
        searchInput     = $("search-input"),
        searchClear     = $("search-clear"),
        webIndicator    = $("web-indicator"),
        btnFlowchart    = $("btn-flowchart"),
        flowBack        = $("flow-back"),
        flowExport      = $("flow-export"),
        flowCanvas      = $("flowchart-canvas"),
        flowCanvasWrap  = $("flow-canvas-wrap"),
        btnHistory      = $("btn-history"),
        historyPanel    = $("history-panel"),
        historyClose    = $("history-close"),
        historyList     = $("history-list"),
        historyClear     = $("history-clear"),
        historyBackdrop = $("history-backdrop"),
        wtOverlay       = $("walkthrough-overlay"),
        wtTooltip       = $("walkthrough-tooltip"),
        wtText          = $("wt-text"),
        wtStepNum       = $("wt-step-num"),
        wtStepTotal     = $("wt-step-total"),
        wtSkip          = $("wt-skip"),
        wtNext          = $("wt-next"),
        toggleSimple    = $("toggle-simple"),
        toggleDetailed  = $("toggle-detailed");

    // ─── STATE ───────────────────────────────────────────────

    var currentMode   = null,
        isLoading     = false,
        lastAiData    = null,
        responseMode  = "simple",
        sessionId     = localStorage.getItem("marooli_session") || generateId();

    localStorage.setItem("marooli_session", sessionId);

    // Pre-warm Ollama so first query is fast
    fetch("/api/warmup", { method: "POST" }).catch(function(){});

    function generateId() {
        return "s_" + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    }

    // ─── AVATARS ─────────────────────────────────────────────

    var AI_AVATAR  = '<img src="/static/avatar.png" alt="M" width="34" height="34">';
    var USER_AVATAR = '<img src="/static/user_avatar.png" alt="You" width="34" height="34">';

    // ─── MODE TOGGLE ─────────────────────────────────────────

    toggleSimple.addEventListener("click", function () {
        responseMode = "simple";
        toggleSimple.classList.add("active");
        toggleDetailed.classList.remove("active");
    });
    toggleDetailed.addEventListener("click", function () {
        responseMode = "detailed";
        toggleDetailed.classList.add("active");
        toggleSimple.classList.remove("active");
    });

    // ─── WALKTHROUGH ─────────────────────────────────────────

    var WT = [
        "Welcome to Marooli. Pick a mode to get started. Reverse Path Finder maps out routes to your goals, and Future Simulator shows where your decisions could take you.",
        "Type your goal or decision below. The more specific you are, the sharper the results. You can also just have a casual conversation.",
        "Your results will show up as clean, structured cards. Feel free to follow up naturally because Marooli remembers what you talked about.",
        "Hit the visual map button for a full screen flowchart of your results. You can also check the history to revisit anything from earlier."
    ];
    var wtStep = 0;

    function startWT() {
        if (localStorage.getItem("marooli_wt_v3")) return;
        wtStep = 0;
        wtStepTotal.textContent = WT.length;
        renderWTStep();
        wtOverlay.classList.remove("hidden");
    }
    function renderWTStep() {
        wtStepNum.textContent = wtStep + 1;
        wtText.textContent = WT[wtStep];
        wtNext.textContent = wtStep === WT.length - 1 ? "Got it" : "Next";
    }
    function advanceWT() {
        wtStep++;
        if (wtStep >= WT.length) { endWT(); return; }
        wtTooltip.style.animation = "none";
        void wtTooltip.offsetHeight;
        wtTooltip.style.animation = "tooltipPop 0.4s cubic-bezier(0.34,1.56,0.64,1) both";
        renderWTStep();
    }
    function endWT() {
        wtOverlay.classList.add("hidden");
        localStorage.setItem("marooli_wt_v3", "1");
    }
    wtSkip.addEventListener("click", endWT);
    wtNext.addEventListener("click", advanceWT);
    setTimeout(startWT, 500);

    // ─── SCREENS ─────────────────────────────────────────────

    function showScreen(target) {
        document.querySelectorAll(".screen").forEach(function (s) { s.classList.remove("active"); });
        target.classList.add("active");
    }

    function enterMode(mode) {
        currentMode = mode;
        chatMessages.innerHTML = "";
        lastAiData = null;

        document.body.className = "";
        document.body.classList.add("mode-" + mode);

        if (mode === "reverse") {
            headerModeTag.textContent = "Reverse Path Finder";
            chatInput.placeholder = "What goal do you want to achieve?";
            addAiMsg("What's the goal? I'll find the paths.");
        } else {
            headerModeTag.textContent = "Future Simulator";
            chatInput.placeholder = "What decision are you considering?";
            addAiMsg("What decision are you weighing?");
        }

        showScreen(chatScreen);
        chatInput.focus();
    }

    cardReverse.addEventListener("click", function () { enterMode("reverse"); });
    cardSimulate.addEventListener("click", function () { enterMode("simulate"); });
    cardReverse.addEventListener("keydown", function (e) { if (e.key === "Enter") enterMode("reverse"); });
    cardSimulate.addEventListener("keydown", function (e) { if (e.key === "Enter") enterMode("simulate"); });

    backBtn.addEventListener("click", function () {
        currentMode = null;
        document.body.className = "";
        showScreen(landingScreen);
    });

    // ─── KEYBOARD SHORTCUTS ──────────────────────────────────

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
            if (flowScreen.classList.contains("active")) {
                showScreen(chatScreen);
                document.body.className = "mode-" + (currentMode || "reverse");
            } else if (chatScreen.classList.contains("active")) {
                currentMode = null;
                document.body.className = "";
                showScreen(landingScreen);
            }
            closeHistory();
        }
        if (e.key === "/" && !e.ctrlKey && document.activeElement !== chatInput && document.activeElement !== searchInput) {
            e.preventDefault();
            searchInput.focus();
        }
    });

    // ─── MESSAGES ────────────────────────────────────────────

    function addUserMsg(text) {
        var el = document.createElement("div");
        el.className = "chat-msg user";
        var av = document.createElement("div");
        av.className = "msg-avatar";
        av.innerHTML = USER_AVATAR;
        var bub = document.createElement("div");
        bub.className = "msg-bubble";
        bub.appendChild(makeCopyBtn(text));
        bub.appendChild(document.createTextNode(text));
        el.appendChild(av);
        el.appendChild(bub);
        chatMessages.appendChild(el);
        scrollBottom();
    }

    function addAiMsg(text) {
        var el = document.createElement("div");
        el.className = "chat-msg ai";
        var av = document.createElement("div");
        av.className = "msg-avatar";
        av.innerHTML = AI_AVATAR;
        var bub = document.createElement("div");
        bub.className = "msg-bubble";
        bub.appendChild(makeCopyBtn(text));
        var span = document.createElement("span");
        span.className = "msg-text";
        bub.appendChild(span);
        el.appendChild(av);
        el.appendChild(bub);
        chatMessages.appendChild(el);
        typeText(span, text, 14);
        scrollBottom();
    }

    function addAiChat(text) {
        var el = document.createElement("div");
        el.className = "chat-msg ai";
        var av = document.createElement("div");
        av.className = "msg-avatar";
        av.innerHTML = AI_AVATAR;
        var bub = document.createElement("div");
        bub.className = "msg-bubble";
        bub.appendChild(makeCopyBtn(text));
        var span = document.createElement("span");
        span.className = "msg-text";
        bub.appendChild(span);
        el.appendChild(av);
        el.appendChild(bub);
        chatMessages.appendChild(el);
        typeText(span, text, 10);
        scrollBottom();
    }

    function addAiWeb(text, sources) {
        var el = document.createElement("div");
        el.className = "chat-msg ai";
        var av = document.createElement("div");
        av.className = "msg-avatar";
        av.innerHTML = AI_AVATAR;
        var bub = document.createElement("div");
        bub.className = "msg-bubble";
        bub.appendChild(makeCopyBtn(text));

        var span = document.createElement("span");
        span.className = "msg-text";
        bub.appendChild(span);

        // source tags
        if (sources && sources.length) {
            var srcDiv = document.createElement("div");
            srcDiv.className = "web-sources";
            sources.forEach(function (s) {
                var a = document.createElement("a");
                a.className = "web-source-tag";
                a.href = s.url;
                a.target = "_blank";
                a.rel = "noopener";
                a.innerHTML = '<span class="web-source-dot"></span>' + escapeHtml(truncate(s.title, 30));
                srcDiv.appendChild(a);
            });
            bub.appendChild(srcDiv);
        }

        el.appendChild(av);
        el.appendChild(bub);
        chatMessages.appendChild(el);
        typeText(span, text, 10);
        scrollBottom();
    }

    function addAiStructured(rawText, type, sources) {
        if (type === "chat") { addAiChat(rawText); return; }
        if (type === "web")  { addAiWeb(rawText, sources); return; }

        var el = document.createElement("div");
        el.className = "chat-msg ai";
        var av = document.createElement("div");
        av.className = "msg-avatar";
        av.innerHTML = AI_AVATAR;
        var bub = document.createElement("div");
        bub.className = "msg-bubble msg-bubble-structured";
        bub.appendChild(makeCopyBtn(rawText));

        var parsed = currentMode === "reverse" ? parsePaths(rawText) : parseSim(rawText);
        lastAiData = { mode: currentMode, data: parsed, raw: rawText };
        var hasCards = false;

        if (currentMode === "reverse" && parsed.paths && parsed.paths.length) {
            hasCards = true;
            var c = document.createElement("div");
            c.className = "ai-cards-container";
            parsed.paths.forEach(function (p) {
                var card = document.createElement("div");
                card.className = "ai-card";
                card.innerHTML = buildPathCard(p);
                c.appendChild(card);
            });
            bub.appendChild(c);
        } else if (currentMode === "simulate" && parsed.sections && parsed.sections.length) {
            hasCards = true;
            var c = document.createElement("div");
            c.className = "ai-cards-container";
            parsed.sections.forEach(function (s) {
                var card = document.createElement("div");
                card.className = "ai-card";
                card.innerHTML = '<div class="ai-card-title">' + escapeHtml(s.title) + '</div><div class="ai-card-value">' + formatText(s.content) + '</div>';
                c.appendChild(card);
            });
            bub.appendChild(c);
        }

        if (!hasCards) {
            var span = document.createElement("span");
            span.className = "msg-text";
            span.textContent = rawText;
            bub.appendChild(span);
        }

        el.appendChild(av);
        el.appendChild(bub);
        chatMessages.appendChild(el);
        scrollBottom();
    }

    function addSkeleton() {
        var el = document.createElement("div");
        el.className = "chat-msg ai";
        el.id = "skeleton-msg";
        var av = document.createElement("div");
        av.className = "msg-avatar";
        av.innerHTML = AI_AVATAR;
        var bub = document.createElement("div");
        bub.className = "msg-bubble";
        bub.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
        el.appendChild(av);
        el.appendChild(bub);
        chatMessages.appendChild(el);
        scrollBottom();
    }

    function removeSkeleton() {
        var s = $("skeleton-msg");
        if (s) s.remove();
    }

    function addError(text) {
        var el = document.createElement("div");
        el.className = "chat-msg ai";
        var av = document.createElement("div");
        av.className = "msg-avatar";
        av.innerHTML = AI_AVATAR;
        var bub = document.createElement("div");
        bub.className = "msg-bubble";
        bub.innerHTML = '<div class="error-msg">' + escapeHtml(text) + '</div>';
        el.appendChild(av);
        el.appendChild(bub);
        chatMessages.appendChild(el);
        scrollBottom();
    }

    // ─── SEND ────────────────────────────────────────────────

    function handleSend() {
        var text = chatInput.value.trim();
        if (!text || isLoading) return;

        addUserMsg(text);
        chatInput.value = "";
        autoResize();
        setLoading(true);
        document.body.classList.add("thinking");
        addSkeleton();

        // check if this might trigger web search
        var maybeWeb = /search|look up|latest|recent|current|2024|2025|2026|price|salary|who is|news|trending|statistics|how much|best .+ for/i.test(text);
        if (maybeWeb) {
            webIndicator.classList.remove("hidden");
        }

        var endpoint = currentMode === "reverse" ? "/api/reverse" : "/api/simulate";
        var body = currentMode === "reverse"
            ? { goal: text, mode: responseMode, session: sessionId }
            : { decision: text, mode: responseMode, session: sessionId };

        fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        })
        .then(function (res) {
            return res.json().then(function (d) { return { ok: res.ok, data: d }; });
        })
        .then(function (r) {
            removeSkeleton();
            webIndicator.classList.add("hidden");
            document.body.classList.remove("thinking");

            if (!r.ok) {
                addError(r.data.error || "Something went wrong.");
            } else {
                var t = r.data.type || "structured";
                addAiStructured(r.data.response, t, r.data.sources);
                saveHistory(text, r.data.response, t);
            }
        })
        .catch(function (err) {
            removeSkeleton();
            webIndicator.classList.add("hidden");
            document.body.classList.remove("thinking");
            addError("Network error — is the server running?");
            console.error(err);
        })
        .finally(function () {
            setLoading(false);
        });
    }

    sendBtn.addEventListener("click", handleSend);
    chatInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    function setLoading(v) { isLoading = v; sendBtn.disabled = v; }
    chatInput.addEventListener("input", autoResize);
    function autoResize() {
        chatInput.style.height = "auto";
        chatInput.style.height = Math.min(chatInput.scrollHeight, 110) + "px";
    }

    // ─── HISTORY ─────────────────────────────────────────────

    function saveHistory(query, response, type) {
        var hist = JSON.parse(localStorage.getItem("marooli_history") || "[]");
        hist.unshift({
            mode: currentMode,
            query: query,
            response: response.substring(0, 200),
            type: type,
            time: Date.now()
        });
        if (hist.length > 30) hist = hist.slice(0, 30);
        localStorage.setItem("marooli_history", JSON.stringify(hist));
    }

    function renderHistory() {
        var hist = JSON.parse(localStorage.getItem("marooli_history") || "[]");
        historyList.innerHTML = "";
        if (!hist.length) {
            historyList.innerHTML = '<div style="padding:1rem;color:var(--text-muted);font-size:0.8rem;text-align:center">No history yet</div>';
            return;
        }
        hist.forEach(function (h) {
            var item = document.createElement("div");
            item.className = "history-item";
            var timeStr = new Date(h.time).toLocaleDateString() + " " + new Date(h.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
            item.innerHTML =
                '<div class="history-item-mode">' + escapeHtml(h.mode === "reverse" ? "Reverse Path" : "Simulator") + '</div>' +
                '<div class="history-item-text">' + escapeHtml(h.query) + '</div>' +
                '<div class="history-item-time">' + timeStr + '</div>';
            historyList.appendChild(item);
        });
    }

    function openHistory() {
        renderHistory();
        historyPanel.classList.remove("hidden");
        historyBackdrop.classList.remove("hidden");
        void historyPanel.offsetHeight;
        historyPanel.classList.add("visible");
    }

    function closeHistory() {
        historyPanel.classList.remove("visible");
        historyBackdrop.classList.add("hidden");
        setTimeout(function () { historyPanel.classList.add("hidden"); }, 350);
    }

    btnHistory.addEventListener("click", openHistory);
    historyClose.addEventListener("click", closeHistory);
    historyBackdrop.addEventListener("click", closeHistory);
    historyClear.addEventListener("click", function () {
        localStorage.removeItem("marooli_history");
        renderHistory();
    });

    // ─── SEARCH ──────────────────────────────────────────────

    var searchTimer = null;
    searchInput.addEventListener("input", function () {
        clearTimeout(searchTimer);
        var q = searchInput.value.trim().toLowerCase();
        searchClear.classList.toggle("hidden", !q);
        searchTimer = setTimeout(function () { filterMsgs(q); }, 50);
    });
    searchClear.addEventListener("click", function () {
        searchInput.value = "";
        searchClear.classList.add("hidden");
        filterMsgs("");
    });

    function filterMsgs(q) {
        chatMessages.querySelectorAll(".chat-msg").forEach(function (m) {
            m.querySelectorAll("mark.search-highlight").forEach(function (mk) {
                var p = mk.parentNode;
                p.replaceChild(document.createTextNode(mk.textContent), mk);
                p.normalize();
            });
            if (!q) { m.style.display = ""; return; }
            if (m.textContent.toLowerCase().indexOf(q) === -1) {
                m.style.display = "none";
            } else {
                m.style.display = "";
                highlightText(m, q);
            }
        });
    }

    function highlightText(container, q) {
        var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        var nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(function (node) {
            var p = node.parentNode;
            if (!p || /SCRIPT|STYLE|TEXTAREA|BUTTON/.test(p.tagName)) return;
            var t = node.textContent, lo = t.toLowerCase(), i = lo.indexOf(q);
            if (i === -1) return;
            var frag = document.createDocumentFragment(), last = 0;
            while (i !== -1) {
                if (i > last) frag.appendChild(document.createTextNode(t.substring(last, i)));
                var mk = document.createElement("mark");
                mk.className = "search-highlight";
                mk.textContent = t.substring(i, i + q.length);
                frag.appendChild(mk);
                last = i + q.length;
                i = lo.indexOf(q, last);
            }
            if (last < t.length) frag.appendChild(document.createTextNode(t.substring(last)));
            p.replaceChild(frag, node);
        });
    }

    // ─── FLOWCHART (FULL SCREEN) ─────────────────────────────

    btnFlowchart.addEventListener("click", function () {
        document.body.classList.remove("mode-reverse", "mode-simulate");
        document.body.classList.add("mode-flowchart");
        showScreen(flowScreen);
        setTimeout(renderFlowchart, 100);
    });

    flowBack.addEventListener("click", function () {
        document.body.classList.remove("mode-flowchart");
        if (currentMode) document.body.classList.add("mode-" + currentMode);
        showScreen(chatScreen);
    });

    flowExport.addEventListener("click", function () {
        if (!lastAiData) return;
        copyToClipboard(lastAiData.raw, flowExport.querySelector("svg") || flowExport);
    });

    function renderFlowchart() {
        var canvas = flowCanvas;
        var ctx = canvas.getContext("2d");
        var dpr = window.devicePixelRatio || 1;
        var cw = flowCanvasWrap.clientWidth - 60;

        if (!lastAiData) {
            canvas.width = cw * dpr; canvas.height = 240 * dpr;
            canvas.style.width = cw + "px"; canvas.style.height = "240px";
            ctx.scale(dpr, dpr);
            ctx.fillStyle = "#5a5a72";
            ctx.font = "13px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("Run a query first to generate the visual map", cw / 2, 120);
            return;
        }

        var nodes = [], edges = [];
        if (lastAiData.mode === "reverse" && lastAiData.data.paths) {
            buildReverseFCData(lastAiData.data, nodes, edges);
        } else if (lastAiData.mode === "simulate" && lastAiData.data.sections) {
            buildSimFCData(lastAiData.data, nodes, edges);
        }
        if (!nodes.length) return;

        var nodeW = 240, nodeH = 56, gapX = 32, gapY = 72;
        layoutFCNodes(nodes, cw, nodeW, nodeH, gapX, gapY);

        var maxY = 0;
        nodes.forEach(function (n) { if (n.y + n.h > maxY) maxY = n.y + n.h; });
        var totalH = maxY + 80;

        canvas.width = cw * dpr; canvas.height = totalH * dpr;
        canvas.style.width = cw + "px"; canvas.style.height = totalH + "px";
        ctx.scale(dpr, dpr);

        edges.forEach(function (e) { drawFCEdge(ctx, nodes[e.from], nodes[e.to]); });
        nodes.forEach(function (n) { drawFCNode(ctx, n); });
    }

    function buildReverseFCData(data, nodes, edges) {
        nodes.push({ id:0, label:"Your Goal", type:"root", level:0, branch:0 });
        var id = 1;
        data.paths.forEach(function (p, pi) {
            var pid = id;
            nodes.push({ id:id, label: truncate(p.name, 36), type:"path", level:1, branch:pi });
            edges.push({ from:0, to:id }); id++;
            p.steps.forEach(function (s, si) {
                nodes.push({ id:id, label: truncate(s, 44), type:"step", level:2+si, branch:pi });
                edges.push({ from: si === 0 ? pid : id-1, to:id }); id++;
            });
        });
    }

    function buildSimFCData(data, nodes, edges) {
        nodes.push({ id:0, label:"Decision", type:"root", level:0, branch:0 });
        data.sections.forEach(function (s, i) {
            nodes.push({ id:i+1, label:s.title, type:"section", level:i+1, branch:0 });
            edges.push({ from:i, to:i+1 });
        });
    }

    function layoutFCNodes(nodes, cw, nw, nh, gx, gy) {
        var levels = {};
        nodes.forEach(function (n) {
            if (!levels[n.level]) levels[n.level] = [];
            levels[n.level].push(n);
        });
        Object.keys(levels).map(Number).sort(function(a,b){return a-b}).forEach(function (lv) {
            var g = levels[lv];
            var tw = g.length * nw + (g.length - 1) * gx;
            var sx = (cw - tw) / 2;
            g.forEach(function (n, i) {
                n.w = nw; n.h = nh;
                n.x = sx + i * (nw + gx);
                n.y = 40 + lv * (nh + gy);
            });
        });
    }

    function wrapText(ctx, text, maxW) {
        var words = text.split(" "), lines = [], line = "";
        for (var i = 0; i < words.length; i++) {
            var test = line ? line + " " + words[i] : words[i];
            if (ctx.measureText(test).width > maxW && line) {
                lines.push(line);
                line = words[i];
            } else {
                line = test;
            }
        }
        if (line) lines.push(line);
        return lines.length > 2 ? [lines[0], lines[1].substring(0, lines[1].length > 3 ? lines[1].length : 3) + "…"] : lines;
    }

    function drawFCNode(ctx, n) {
        var x=n.x,y=n.y,w=n.w,h=n.h,r=12;

        if (n.type === "root") {
            ctx.shadowColor = "rgba(124,58,237,0.3)"; ctx.shadowBlur = 22;
        }

        ctx.beginPath();
        ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
        ctx.arcTo(x+w,y,x+w,y+r,r); ctx.lineTo(x+w,y+h-r);
        ctx.arcTo(x+w,y+h,x+w-r,y+h,r); ctx.lineTo(x+r,y+h);
        ctx.arcTo(x,y+h,x,y+h-r,r); ctx.lineTo(x,y+r);
        ctx.arcTo(x,y,x+r,y,r); ctx.closePath();

        if (n.type === "root") {
            var g = ctx.createLinearGradient(x,y,x+w,y+h);
            g.addColorStop(0,"#7c3aed"); g.addColorStop(1,"#6366f1");
            ctx.fillStyle = g;
        } else if (n.type === "path" || n.type === "section") {
            var g = ctx.createLinearGradient(x,y,x+w,y+h);
            g.addColorStop(0,"rgba(99,102,241,0.25)"); g.addColorStop(1,"rgba(124,58,237,0.12)");
            ctx.fillStyle = g;
        } else {
            ctx.fillStyle = "rgba(255,255,255,0.04)";
        }
        ctx.fill();
        ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;

        ctx.strokeStyle = n.type === "root" ? "rgba(167,139,250,0.45)" : "rgba(255,255,255,0.07)";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = n.type === "root" ? "#fff" : (n.type === "step" ? "#9a9ab2" : "#e8e8f0");
        ctx.font = (n.type === "root" ? "600 " : "400 ") + "11.5px Inter, sans-serif";
        ctx.textAlign = "center";

        var maxTW = w - 24;
        var lines = wrapText(ctx, n.label, maxTW);
        var lineH = 15;
        var startY = y + h/2 - (lines.length - 1) * lineH / 2;
        lines.forEach(function (ln, i) {
            ctx.fillText(ln, x + w/2, startY + i * lineH);
        });
    }

    function drawFCEdge(ctx, from, to) {
        var sx = from.x + from.w/2, sy = from.y + from.h;
        var ex = to.x + to.w/2, ey = to.y;
        var cpY = (sy + ey) / 2;

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.bezierCurveTo(sx, cpY, ex, cpY, ex, ey);
        ctx.strokeStyle = "rgba(124,58,237,0.18)";
        ctx.lineWidth = 1.2;
        ctx.stroke();

        var as = 4;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - as, ey - as * 1.5);
        ctx.lineTo(ex + as, ey - as * 1.5);
        ctx.closePath();
        ctx.fillStyle = "rgba(124,58,237,0.28)";
        ctx.fill();
    }

    // ─── PARSING ─────────────────────────────────────────────

    function parsePaths(raw) {
        var result = { paths: [] };
        var blocks = raw.split(/(?=Path Name:)/gi).filter(function(b){return b.trim()});
        blocks.forEach(function (block) {
            var p = {};
            var nm = block.match(/Path Name:\s*(.+)/i);
            p.name = nm ? clean(nm[1]) : "Untitled";

            var st = block.match(/Steps:\s*([\s\S]*?)(?=Timeline:|Difficulty:|Risks:|Path Name:|$)/i);
            p.steps = st ? st[1].split(/\n/).map(function(s){return clean(s.replace(/^[\s\-\*\d.]+/,""))}).filter(Boolean) : [];

            var tm = block.match(/Timeline:\s*(.+)/i);
            p.timeline = tm ? clean(tm[1]) : "";

            var df = block.match(/Difficulty:\s*(.+)/i);
            p.difficulty = df ? clean(df[1]) : "";

            var rk = block.match(/Risks:\s*([\s\S]*?)(?=Path Name:|$)/i);
            p.risks = rk ? rk[1].split(/\n/).map(function(s){return clean(s.replace(/^[\s\-\*\d.]+/,""))}).filter(Boolean) : [];

            result.paths.push(p);
        });
        return result;
    }

    function parseSim(raw) {
        var result = { sections: [] };
        var markers = [
            {regex:/1\s*Year\s*Outcome:?\s*/i, title:"1 Year"},
            {regex:/5\s*Year\s*Outcome:?\s*/i, title:"5 Years"},
            {regex:/10\s*Year\s*Outcome:?\s*/i, title:"10 Years"},
            {regex:/Risks:?\s*/i, title:"Risks"},
            {regex:/Regret\s*Analysis:?\s*/i, title:"Regret Analysis"}
        ];
        var found = [];
        markers.forEach(function(m) {
            var match = raw.match(m.regex);
            if (match) found.push({title:m.title, index:match.index, len:match[0].length});
        });
        found.sort(function(a,b){return a.index-b.index});
        for (var i=0;i<found.length;i++) {
            var start = found[i].index + found[i].len;
            var end = (i+1<found.length) ? found[i+1].index : raw.length;
            var content = raw.substring(start,end).replace(/^\*+|\*+$/gm,'').replace(/^#+\s*/gm,'').trim();
            result.sections.push({title:found[i].title, content:content});
        }
        if (!result.sections.length) result.sections.push({title:"Analysis", content:raw});
        return result;
    }

    function buildPathCard(p) {
        var h = '<div class="ai-card-title">' + escapeHtml(p.name) + '</div>';
        if (p.steps.length) {
            h += '<div class="ai-card-field"><div class="ai-card-label">Steps</div><div class="ai-card-value"><ul>';
            p.steps.forEach(function(s){h+='<li>'+escapeHtml(s)+'</li>'});
            h += '</ul></div></div>';
        }
        if (p.timeline) h += '<div class="ai-card-field"><div class="ai-card-label">Timeline</div><div class="ai-card-value">'+escapeHtml(p.timeline)+'</div></div>';
        if (p.difficulty) {
            var dc = "badge-medium";
            var dl = p.difficulty.toLowerCase();
            if (dl.indexOf("easy")!==-1) dc="badge-easy";
            else if (dl.indexOf("hard")!==-1) dc="badge-hard";
            h += '<div class="ai-card-field"><div class="ai-card-label">Difficulty</div><div class="ai-card-value"><span class="badge '+dc+'">'+escapeHtml(p.difficulty)+'</span></div></div>';
        }
        if (p.risks && p.risks.length) {
            h += '<div class="ai-card-field"><div class="ai-card-label">Risks</div><div class="ai-card-value"><ul>';
            p.risks.forEach(function(r){h+='<li>'+escapeHtml(r)+'</li>'});
            h += '</ul></div></div>';
        }
        return h;
    }

    // ─── HELPERS ─────────────────────────────────────────────

    function clean(s){return s.replace(/^\*+|\*+$/g,'').replace(/^#+\s*/,'').trim()}
    function truncate(s,n){return s.length>n?s.substring(0,n-1)+"…":s}
    function formatText(t){return escapeHtml(t.replace(/\*\*/g,'').replace(/^\*\s+/gm,'• ').replace(/^-\s+/gm,'• ').trim())}
    function escapeHtml(s){var d=document.createElement("div");d.appendChild(document.createTextNode(s));return d.innerHTML}
    function scrollBottom(){requestAnimationFrame(function(){chatBody.scrollTop=chatBody.scrollHeight})}

    function typeText(el, text, speed) {
        var i=0;
        var iv = setInterval(function(){
            if (i<text.length){el.textContent+=text.charAt(i);i++;if(i%4===0)scrollBottom()}
            else clearInterval(iv);
        }, speed);
    }

    function makeCopyBtn(text) {
        var b = document.createElement("button");
        b.className = "copy-btn"; b.textContent = "Copy";
        b.addEventListener("click", function(){copyToClipboard(text,b)});
        return b;
    }

    function copyToClipboard(text, btn) {
        navigator.clipboard.writeText(text).then(function(){showCopied(btn)}).catch(function(){
            var ta=document.createElement("textarea");ta.value=text;ta.style.position="fixed";ta.style.left="-9999px";
            document.body.appendChild(ta);ta.select();document.execCommand("copy");document.body.removeChild(ta);
            showCopied(btn);
        });
    }
    function showCopied(b){
        var orig=b.textContent;b.textContent="Copied!";b.classList.add("copied");
        setTimeout(function(){b.textContent=orig;b.classList.remove("copied")},1300);
    }

})();
