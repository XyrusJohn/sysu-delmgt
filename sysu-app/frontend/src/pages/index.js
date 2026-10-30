import {AuthService} from "../api/authService.js";

//  Logout signal from QR page — must be handled BEFORE AuthService.subscribe
//  registers onAuthStateChanged, otherwise the listener fires first and
//  redirects back to QR before signOut clears the session.
if (new URLSearchParams(window.location.search).get("logout") === "1") {
    AuthService.logout({redirect: false}).finally(() => {
        //  Strip the ?logout=1 param so the clean URL is bookmarked
        window.location.replace(window.location.pathname);
    });
    //  Stop the rest of the page from loading until signOut completes
    throw new Error("LOGOUT_REDIRECT");
}

document.addEventListener("DOMContentLoaded", () => {
    //  Elements
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const loginBtn = document.getElementById("loginBtn");
    const loginBtnText = document.getElementById("loginBtnText");
    const alertMsg = document.getElementById("alertMsg");
    const eyeBtn = document.getElementById("eyeBtn");
    const rememberMe = document.getElementById("rememberMe");

    //  Check if redirected due to deleted account
    const urlParams = new URLSearchParams(window.location.search);
    const reason = urlParams.get("reason");
    const storedAuthMsg = sessionStorage.getItem("auth_error_message");
    if (reason === "account_deleted" || storedAuthMsg) {
        if (alertMsg) {
            alertMsg.textContent = storedAuthMsg || "Your account has been deleted by an administrator.";
            alertMsg.style.display = "block";
            alertMsg.style.color = "#ff4d4f";
        }
        sessionStorage.removeItem("auth_error_message");
    }

    //  Real-time Role & Status Monitor
    AuthService.subscribe(async (user, error) => {
        if (error) {
            if (error.message === 'NOT_REGISTERED') {
                document.getElementById('regOverlay')?.classList.add('show');
            }
            return;
        }

        if (user) {
            //  If the role has not loaded into the session yet, wait briefly.
            if (!user.role || user.role === 'pending') {
                await new Promise(r => setTimeout(r, 1500));
            }

            //  IMPORTANT: Do not redirect if the user is on the QR generator page
            if (window.location.pathname.includes('qr-generator')) {
                return;
            }

            if (user.role && user.role !== 'pending') {
                window.location.href = "dashboard.html";
            } else {
                //  Still pending
                const pendingOverlay = document.getElementById('pendingOverlay');
                if (pendingOverlay) {
                    const pendingName = document.getElementById('pendingName');
                    if (pendingName) pendingName.textContent = user.name || 'User';
                    pendingOverlay.classList.add('show');
                }
            }
        }
    });

    //  Slide System
    let curSlide = 0;
    const TOTAL_SLIDES = 3;
    let slideTimer = setInterval(() => nextSlide(), 4500);

    function goSlide(n) {
        clearInterval(slideTimer);
        const prevSlideEl = document.getElementById("slide" + curSlide);
        const prevDot = document.getElementById("sdot" + curSlide);
        if (prevSlideEl) prevSlideEl.classList.remove("active");
        if (prevDot) prevDot.classList.remove("on");

        curSlide = n;

        const nextSlideEl = document.getElementById("slide" + curSlide);
        const nextDot = document.getElementById("sdot" + curSlide);
        if (nextSlideEl) nextSlideEl.classList.add("active");
        if (nextDot) nextDot.classList.add("on");

        slideTimer = setInterval(() => nextSlide(), 4500);
    }

    function nextSlide() {
        goSlide((curSlide + 1) % TOTAL_SLIDES);
    }

    function prevSlide() {
        goSlide((curSlide + TOTAL_SLIDES - 1) % TOTAL_SLIDES);
    }

    document.getElementById("prevSlideBtn")?.addEventListener("click", prevSlide);
    document.getElementById("nextSlideBtn")?.addEventListener("click", nextSlide);

    for (let i = 0; i < TOTAL_SLIDES; i++) {
        document
            .getElementById("sdot" + i)
            ?.addEventListener("click", () => goSlide(i));
    }

    //  Animated Stats Counters
    function animateCount(el, target, suffix, duration) {
        if (!el) return;
        let start = 0;
        const step = target / (duration / 16);
        const timer = setInterval(() => {
            start = Math.min(start + step, target);
            el.innerHTML = Math.round(start) + (suffix || "");
            if (start >= target) clearInterval(timer);
        }, 16);
    }

    setTimeout(() => {
        animateCount(document.getElementById("statTrucks"), 47, "", 1200);
        animateCount(document.getElementById("statDeliveries"), 138, "", 1600);
        animateCount(
            document.getElementById("statUptime"),
            99,
            '<span class="accent">%</span>',
            800,
        );
    }, 600);

    //  Toggle Password
    if (eyeBtn) {
        eyeBtn.addEventListener("click", () => {
            const isPass = passwordInput.type === "password";
            passwordInput.type = isPass ? "text" : "password";
            document.getElementById("eyeOpen").style.display = isPass ? "none" : "";
            document.getElementById("eyeClosed").style.display = isPass ? "" : "none";
        });
    }

    //  Alert Helpers
    function showAlert(msg, type = "error") {
        alertMsg.textContent = msg;
        alertMsg.className = "alert-msg show " + type;
        if (type !== "success") {
            usernameInput.classList.remove("error-field");
            passwordInput.classList.remove("error-field");
        }
    }

    function showFieldError(fieldEl, msg) {
        showAlert(msg, "error");
        fieldEl.classList.add("error-field");
        fieldEl.focus();
    }

    function clearAlert() {
        alertMsg.classList.remove("show");
        usernameInput.classList.remove("error-field");
        passwordInput.classList.remove("error-field");
    }

    [usernameInput, passwordInput].forEach((el) => {
        if (el) el.addEventListener("input", clearAlert);
    });

    //  Auth Handling
    if (loginBtn) {
        loginBtn.addEventListener("click", async () => {
            clearAlert();
            const username = usernameInput.value.trim();
            const pass = passwordInput.value;

            if (!username) {
                showFieldError(usernameInput, "Please enter your username.");
                return;
            }
            if (!/^[a-z0-9][a-z0-9._-]{2,31}$/i.test(username)) {
                showFieldError(usernameInput, "Use 3–32 letters, numbers, dots, dashes, or underscores.");
                return;
            }
            if (pass.length < 8 || pass.length > 128) {
    showFieldError(
        passwordInput,
        "Password must be at least 8 and no more than 128 characters.",
    );
    return;
}

            //  Loading state
            loginBtn.disabled = true;
            loginBtnText.innerHTML =
                '<span class="spinner"></span><span style="margin-left:6px;">Signing in...</span>';

            try {
                await AuthService.login(username, pass, {remember: rememberMe?.checked !== false});
                const result = await AuthService.check();

                if (result.data) {
                    if (result.data.role === 'pending' || result.data.status === 'inactive') {
                        const pendingName = document.getElementById('pendingName');
                        if (pendingName) pendingName.textContent = result.data.name || result.data.username;
                        document.getElementById('pendingOverlay').classList.add('show');
                        return;
                    }

                    localStorage.setItem("userData", JSON.stringify(result.data));

                    //  Show success overlay briefly (redirect is immediate so user barely sees it)
                    const overlay = document.getElementById("successOverlay");
                    const nameEl = document.getElementById("successName");
                    const name = result.data.displayName || result.data.name || result.data.username || "Admin";
                    if (nameEl) nameEl.textContent = "Welcome, " + name + "!";

                    //  Immediate redirect based on role — no setTimeout race condition
                    window.location.href = "dashboard.html";
                }
            } catch (error) {
                showAlert(error.message || "Login failed. Please try again.", "error");

                //  Reset button
                loginBtn.disabled = false;
                loginBtnText.textContent = "Sign In";
            }
        });
    }

    //  Handle Enter Key
    if (passwordInput) {
        passwordInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") loginBtn.click();
        });
    }
    if (usernameInput) {
        usernameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") passwordInput.focus();
        });
    }

    //  Forgot password & Contact Admin
    document.getElementById("contactAdminBtn")?.addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById("regOverlay")?.classList.add("show");
    });

    document.getElementById("forgotBtn")?.addEventListener("click", (e) => {
        e.preventDefault();
        const username = usernameInput.value.trim();
        if (!username) {
            showFieldError(
                usernameInput,
                "Enter your username first, then contact your administrator for a password reset.",
            );
        } else {
            showAlert(
                "For a password reset, please contact your SYSU IT Administrator.",
                "success",
            );
        }
    });

    //  Registration Modal Handling
    const regOverlay = document.getElementById("regOverlay");
    const pendingOverlay = document.getElementById("pendingOverlay");
    const cancelRegBtn = document.getElementById("cancelRegBtn");
    const submitRegBtn = document.getElementById("submitRegBtn");
    const pendingBackBtn = document.getElementById("pendingBackBtn");

    if (cancelRegBtn) {
        cancelRegBtn.addEventListener("click", async () => {
            regOverlay.classList.remove("show");
            document.getElementById("regPassword").value = "";
        });
    }

    if (submitRegBtn) {
        submitRegBtn.addEventListener("click", async () => {
            const HTML_SANITIZE = (s) => (s || "").replace(/[<>]/g, "").trim();
            const name = HTML_SANITIZE(document.getElementById('regName').value);
            const phone = HTML_SANITIZE(document.getElementById('regPhone').value);
            const pos = HTML_SANITIZE(document.getElementById('regPosition').value);
            const username = document.getElementById('regUsername').value.trim();
            const password = document.getElementById('regPassword').value;

            if (!name || !phone || !pos || !username || !password) {
                showAlert("Complete the registration fields first.", "error");
                return;
            }
            if (!/^[a-z0-9][a-z0-9._-]{2,31}$/i.test(username)) {
                showAlert("Use 3–32 letters, numbers, dots, dashes, or underscores for your username.", "error");
                return;
            }
            if (password.length < 8 || password.length > 128) {
                showAlert("Password must be at least 8 and no more than 128 characters.", "error");
                return;
            }

            submitRegBtn.disabled = true;
            submitRegBtn.innerHTML = "Submitting...";

            try {
                const user = await AuthService.register({
                    username,
                    password,
                    displayName: name,
                    profile: {name, phone, position: pos},
                }, {remember: rememberMe?.checked !== false});

                regOverlay.classList.remove("show");
                const pendingName = document.getElementById('pendingName');
                if (pendingName) pendingName.textContent = user.name || name;
                pendingOverlay.classList.add("show");
            } catch (err) {
                showAlert(err.message || "Registration failed. Please try again.", "error");
            } finally {
                submitRegBtn.disabled = false;
                submitRegBtn.innerHTML = "Submit Request";
            }
        });
    }

    if (pendingBackBtn) {
        pendingBackBtn.addEventListener("click", async () => {
            pendingOverlay.classList.remove("show");
            await AuthService.logout({redirect: false});
        });
    }

});
