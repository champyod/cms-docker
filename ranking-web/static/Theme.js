/* RWTheme - light/dark toggle for the ranking page. No build step.
 *
 * The theme lives on <html data-theme> so the pre-paint boot snippet in the
 * template can apply it before the stylesheet paints. Charts read it through
 * RWTheme.ink()/RWTheme.grid(); the d3 charts take it through setTheme().
 * The choice persists in localStorage and defaults to light.
 */

var RWTheme = new function () {
    var self = this;

    var KEY = "cms.rws.theme";

    self.current = function () {
        var stored = null;
        try {
            stored = window.localStorage.getItem(KEY);
        } catch (e) {}
        return stored === "dark" ? "dark" : "light";
    };

    self.isDark = function () {
        return document.documentElement.getAttribute("data-theme") === "dark";
    };

    self.ink = function () {
        return self.isDark() ? "#e8e8e8" : "#000000";
    };

    self.grid = function () {
        return self.isDark() ? "#3a3d46" : "#e3e3e3";
    };

    self.axis = function () {
        return self.isDark() ? "#6a6d75" : "#b8b8b8";
    };

    self.apply = function (name) {
        var next = (name === "dark") ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", next);
        try {
            window.localStorage.setItem(KEY, next);
        } catch (e) {}
        var button = document.getElementById("Theme_toggle");
        if (button) {
            button.textContent = next === "dark" ? "Light" : "Dark";
            button.setAttribute("aria-pressed", next === "dark" ? "true" : "false");
        }
        if (window.PerspectiveCharts && PerspectiveCharts.setTheme) {
            PerspectiveCharts.setTheme(next);
        }
        if (window.Overview && Overview.setTheme) {
            Overview.setTheme(next === "dark");
        }
        if (window.Perspectives && Perspectives.refresh) {
            Perspectives.refresh();
        }
    };

    self.toggle = function () {
        self.apply(self.isDark() ? "light" : "dark");
    };

    self.init = function () {
        self.apply(self.current());
        var button = document.getElementById("Theme_toggle");
        if (button) {
            button.addEventListener("click", function () {
                self.toggle();
            });
        }
    };
}();
