/* The perspective framework: a tab bar over the board, a registry every view plugs
 * into, and one place that decides what happens when the tabs do not fit. The tab
 * set is panel-driven through window.RankingPerspectives, defaulting to the five
 * views the board shipped before. */

var Perspectives = new function () {
    var self = this;

    self.DEFAULT_CONFIG = {
        version: 1,
        default: "board",
        layout: { overflow: "wrap" },
        tabs: [
            { id: "board", enabled: true },
            { id: "teams", enabled: true },
            { id: "tasks", enabled: true },
            { id: "scores", enabled: true },
            { id: "progress", enabled: true }
        ]
    };

    self.registry = {};
    self.active = null;
    self.tabs = [];
    self.anonymous = false;

    /* A view registers once with an id, a label and a factory returning mount/refresh. */
    self.register = function (id, factory) {
        self.registry[id] = factory;
    };

    self.config = function () {
        var injected = window.RankingPerspectives;
        if (injected === null || injected === undefined || typeof injected !== "object") {
            return self.DEFAULT_CONFIG;
        }
        return injected;
    };

    /* An unknown id in a hand-edited config is dropped, not rendered as a dead tab. */
    self.enabled_tabs = function () {
        var config = self.config();
        var listed = config.tabs || [];
        var tabs = [];
        for (var index = 0; index < listed.length; index += 1) {
            var tab = listed[index];
            if (tab && tab.enabled !== false && self.registry[tab.id] !== undefined) {
                tabs.push({ id: tab.id, options: tab.options || {} });
            }
        }
        if (tabs.length === 0 && self.registry.board !== undefined) {
            tabs.push({ id: "board", options: {} });
        }
        return tabs;
    };

    self.init = function () {
        self.$panel = $("#ViewsPanel");
        if (self.$panel.length === 0) {
            return;
        }
        self.$panel.html(
            '<div id="Perspectives_bar"></div>' +
            '<div id="Perspectives_panels"></div>'
        );
        self.$panels = $("#Perspectives_panels");
        self.anonymous = document.body.getAttribute("data-board-anonymous") === "true";
        self.tabs = self.enabled_tabs();
        self.views = {};
        self.build_views();
        self.render_bar();
        self.select(self.initial_id());
    };

    /* The board view has no element; it is the Scoreboard table the page already draws. */
    self.build_views = function () {
        for (var index = 0; index < self.tabs.length; index += 1) {
            var tab = self.tabs[index];
            if (tab.id === "board") {
                continue;
            }
            var $container = $('<div class="persp-view" data-perspective="' + tab.id + '"></div>');
            self.$panels.append($container);
            var view = self.registry[tab.id]();
            view.mount($container, tab.options);
            self.views[tab.id] = view;
        }
    };

    self.initial_id = function () {
        var stored = window.localStorage.getItem("cms.rws.perspective");
        if (stored !== null && self.id_available(stored)) {
            return stored;
        }
        var preferred = self.config().default;
        if (preferred !== undefined && self.id_available(preferred)) {
            return preferred;
        }
        return self.tabs[0].id;
    };

    self.id_available = function (id) {
        for (var index = 0; index < self.tabs.length; index += 1) {
            if (self.tabs[index].id === id) {
                return true;
            }
        }
        return false;
    };

    self.render_bar = function () {
        var buttons = "";
        for (var index = 0; index < self.tabs.length; index += 1) {
            var tab = self.tabs[index];
            buttons += '<button type="button" class="persp-tab" data-perspective="' +
                tab.id + '">' + escapeHTML(self.label(tab.id)) + "</button>";
        }
        $("#Perspectives_bar").html(buttons + self.anonymous_control());
        self.apply_overflow();
        $("#Perspectives_bar").on("click", ".persp-tab", function () {
            self.select($(this).data("perspective"));
        });
        $("#Views_anon_box").on("change", function () {
            self.set_anonymous($(this).is(":checked"));
        });
    };

    self.label = function (id) {
        var view = self.registry[id]();
        return view.label;
    };

    self.anonymous_control = function () {
        return '<label id="Views_anon"><input type="checkbox" id="Views_anon_box"' +
            (self.anonymous ? " checked" : "") + " /> Anonymous</label>";
    };

    /* The one overflow rule: wrap shows every tab, scroll pans, menu hides the overflow. */
    self.apply_overflow = function () {
        var policy = (self.config().layout || {}).overflow || "wrap";
        var $tabs = $("#Perspectives_bar .persp-tab");
        var widths = [];
        $tabs.each(function () {
            widths.push($(this).outerWidth(true));
        });
        var chosen = PerspectivesLogic.chooseOverflow(self.$panel.innerWidth(), widths, policy);
        $("#Perspectives_bar").attr("data-overflow", chosen.mode);
        $("#Perspectives_more").remove();
        if (chosen.mode !== "menu" || chosen.firstHidden >= widths.length) {
            $tabs.show();
            return;
        }
        $tabs.each(function (index) {
            $(this).toggle(index < chosen.firstHidden);
        });
        self.render_more_menu(chosen.firstHidden);
    };

    self.render_more_menu = function (firstHidden) {
        var hidden = self.tabs.slice(firstHidden);
        if (hidden.length === 0) {
            return;
        }
        var items = "";
        for (var index = 0; index < hidden.length; index += 1) {
            items += '<button type="button" class="persp-tab" data-perspective="' +
                hidden[index].id + '">' + escapeHTML(self.label(hidden[index].id)) + "</button>";
        }
        $("#Perspectives_bar").append(
            '<span id="Perspectives_more"><button type="button" class="persp-more">\u22ef</button>' +
            '<span id="Perspectives_more_menu">' + items + "</span></span>"
        );
    };

    self.select = function (id) {
        if (!self.id_available(id)) {
            id = self.tabs[0].id;
        }
        self.active = id;
        window.localStorage.setItem("cms.rws.perspective", id);
        $("#Perspectives_bar .persp-tab").each(function () {
            $(this).toggleClass("active", $(this).data("perspective") === id);
        });
        $(".persp-view", self.$panels).hide();
        $("#InnerFrame > table#Scoreboard").toggle(id === "board");
        if (id !== "board" && self.views[id] !== undefined) {
            $('.persp-view[data-perspective="' + id + '"]', self.$panels).show();
            self.views[id].refresh();
        }
    };

    self.set_anonymous = function (on) {
        self.anonymous = on;
        $("body").toggleClass("views-anonymous", on);
        if (self.active !== null && self.views[self.active] !== undefined) {
            self.views[self.active].refresh();
        }
    };

    self.refresh = function () {
        if (self.active !== null && self.views[self.active] !== undefined) {
            self.views[self.active].refresh();
        }
    };

    self.display_name = function (f_name, l_name) {
        if (self.anonymous) {
            return "\u2014";
        }
        var name = (f_name + " " + l_name).replace(/^\s+|\s+$/g, "");
        return name === "" ? "\u2014" : name;
    };

    $(window).on("resize", function () {
        if (self.$panel !== undefined) {
            self.apply_overflow();
        }
    });

    /* A live score change re-draws the view on screen, so a chart is never stale. */
    DataStore.score_events.add(function () {
        self.refresh();
    });
    DataStore.override_events.add(function () {
        self.refresh();
    });
};
