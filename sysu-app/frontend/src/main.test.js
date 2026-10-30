describe("saved theme startup", () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.removeAttribute("data-theme");
        vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("restores light mode before the page UI initializes", async () => {
        localStorage.setItem("sysu-theme", "light");

        await import("./main.js");

        expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });

    test("keeps the dark default when light mode is not saved", async () => {
        localStorage.setItem("sysu-theme", "dark");
        document.documentElement.setAttribute("data-theme", "light");

        await import("./main.js?dark-default-test");

        expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    });
});
