const API = window.IRPB_API_BASE;

const $ = (id) => document.getElementById(id);

function showMessage(id, message, error = false) {
    const element = $(id);
    if (!element) return;
    element.textContent = message;
    element.className = error ? "message error" : "message success";
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

async function api(path, options = {}) {
    const response = await fetch(API + path, {
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {})
        }
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(result.error || "Request failed");
    }

    return result;
}

function getSavedUser() {
    try {
        return JSON.parse(localStorage.getItem("irpbUser"));
    } catch {
        return null;
    }
}

function saveUser(user) {
    localStorage.setItem("irpbUser", JSON.stringify(user));
}

function validCoordinates(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) &&
        lat >= -90 && lat <= 90 &&
        lon >= -180 && lon <= 180;
}

function getCoordinates() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("Geolocation is unavailable. Enter coordinates manually."));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            position => resolve({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
            }),
            () => reject(new Error(
                "GPS unavailable. Enter your latitude and longitude manually."
            )),
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });
}

async function getCoordinatesOrManual() {
    try {
        return await getCoordinates();
    } catch (error) {
        const lat = Number($("latitude")?.value);
        const lon = Number($("longitude")?.value);

        if (!validCoordinates(lat, lon)) {
            throw error;
        }

        return { latitude: lat, longitude: lon };
    }
}

// USER REGISTRATION
async function registerUser(event) {
    event.preventDefault();

    const name = $("name").value.trim();
    const email = $("email").value.trim();
    const phone = $("phone").value.trim();
    const consent = $("locationConsent").checked;

    if (!name || !email || !phone) {
        showMessage("registerMessage", "Please complete all fields.", true);
        return;
    }

    const payload = { name, email, phone, consent };

    if (consent) {
        try {
            const coordinates = await getCoordinates();
            Object.assign(payload, coordinates);
        } catch {
            // Registration can continue without coordinates.
            // Coordinates can be supplied when reporting an SOS.
        }
    }

    try {
        const result = await api("/api/register", {
            method: "POST",
            body: JSON.stringify(payload)
        });

        saveUser(result.user);

        $("registeredUser").textContent =
            "Registered as: " + result.user.name;

        showMessage(
            "registerMessage",
            "Registration successful. Your user ID has been saved on this device."
        );

        await loadUserIncidents();
    } catch (error) {
        showMessage("registerMessage", error.message, true);
    }
}

// SOS ACTIVATION
async function activateSOS() {
    const user = getSavedUser();

    if (!user?.user_id) {
        showMessage("sosMessage", "Please register before activating SOS.", true);
        return;
    }

    if (!user.consent) {
        showMessage(
            "sosMessage",
            "Location-sharing consent is required for this project’s nearby notification feature.",
            true
        );
        return;
    }

    const button = $("sosButton");
    button.disabled = true;
    button.textContent = "SENDING SOS...";

    try {
        const coordinates = await getCoordinatesOrManual();

        const result = await api("/api/sos", {
            method: "POST",
            body: JSON.stringify({
                user_id: user.user_id,
                ...coordinates
            })
        });

        const sent = (result.email_results || []).filter(x => x.sent).length;
        const nearby = result.nearby_count ?? 0;

        showMessage(
            "sosMessage",
            `SOS created. Nearby users: ${nearby}. Initial emails reported sent: ${sent}. Incident ID: ${result.incident.incident_id}`
        );

        await loadUserIncidents();

    } catch (error) {
        showMessage("sosMessage", error.message, true);
    } finally {
        button.disabled = false;
        button.textContent = "ACTIVATE SOS";
    }
}

// USER INCIDENT HISTORY
async function loadUserIncidents() {
    const user = getSavedUser();
    const container = $("userIncidents");

    if (!container) return;

    if (!user?.user_id) {
        container.textContent = "Please register to view your incidents.";
        return;
    }

    try {
        const result = await api(
            "/api/user/incidents/" + encodeURIComponent(user.user_id)
        );

        const incidents = result.incidents || [];

        if (!incidents.length) {
            container.innerHTML = "<p>No incidents reported yet.</p>";
            return;
        }

        container.innerHTML = incidents.map(incident => `
            <article class="item-card">
                <h3>Incident: ${escapeHTML(incident.incident_id)}</h3>
                <p>Status: <strong>${escapeHTML(incident.status)}</strong></p>
                <p>Reported: ${escapeHTML(incident.created_at)}</p>
                <p>Nearby users detected: ${(incident.nearby_users || []).length}</p>
            </article>
        `).join("");

    } catch (error) {
        container.textContent = error.message;
    }
}

// ADMIN DASHBOARD
async function loadAdmin() {
    try {
        const result = await api("/api/incidents");

        const users = result.users || [];
        const incidents = result.incidents || [];
        const notifications = result.notifications || [];

        $("totalUsers").textContent = users.length;
        $("totalIncidents").textContent = incidents.length;
        $("activeIncidents").textContent =
            incidents.filter(i => i.status === "Active").length;
        $("totalNotifications").textContent = notifications.length;

        $("adminUsers").innerHTML = users.length
            ? users.map(user => `
                <article class="item-card">
                    <h3>${escapeHTML(user.name)}</h3>
                    <p>Email: ${escapeHTML(user.email)}</p>
                    <p>Phone: ${escapeHTML(user.phone)}</p>
                    <p>Location consent: ${user.consent ? "Yes" : "No"}</p>
                    <p>Location available:
                        ${user.latitude != null && user.longitude != null ? "Yes" : "No"}
                    </p>
                </article>
            `).join("")
            : "<p>No registered users.</p>";

        $("adminIncidents").innerHTML = incidents.length
            ? incidents.map(incident => `
                <article class="item-card">
                    <h3>${escapeHTML(incident.reporter_name || "Unknown reporter")}</h3>
                    <p>Incident ID: ${escapeHTML(incident.incident_id)}</p>
                    <p>Status: <strong>${escapeHTML(incident.status)}</strong></p>
                    <p>Created: ${escapeHTML(incident.created_at)}</p>
                    <p>Nearby users: ${(incident.nearby_users || []).length}</p>
                    <p>Acknowledged: ${incident.acknowledged ? "Yes" : "No"}</p>

                    <div class="actions">
                        <button type="button"
                            onclick="acknowledgeIncident('${encodeURIComponent(incident.incident_id)}')">
                            Acknowledge
                        </button>

                        <button type="button" class="resolve-button"
                            onclick="resolveIncident('${encodeURIComponent(incident.incident_id)}')"
                            ${incident.status === "Resolved" ? "disabled" : ""}>
                            Resolve
                        </button>
                    </div>
                </article>
            `).join("")
            : "<p>No incidents reported.</p>";

        $("adminNotifications").innerHTML = notifications.length
            ? notifications.map(notification => `
                <article class="item-card">
                    <p>Email: ${escapeHTML(notification.email)}</p>
                    <p>Incident ID: ${escapeHTML(notification.incident_id)}</p>
                    <p>Message: ${escapeHTML(notification.message)}</p>
                    <p>Status: ${escapeHTML(notification.status)}</p>
                    <p>Time: ${escapeHTML(notification.created_at)}</p>
                </article>
            `).join("")
            : "<p>No notification records.</p>";

        showMessage("adminMessage", "Dashboard refreshed.");

    } catch (error) {
        showMessage("adminMessage", error.message, true);
    }
}

// ACKNOWLEDGE INCIDENT
async function acknowledgeIncident(encodedId) {
    const id = decodeURIComponent(encodedId);

    try {
        await api("/api/acknowledge/" + encodeURIComponent(id), {
            method: "POST",
            body: JSON.stringify({})
        });

        await loadAdmin();
    } catch (error) {
        showMessage("adminMessage", error.message, true);
    }
}

// RESOLVE INCIDENT
async function resolveIncident(encodedId) {
    const id = decodeURIComponent(encodedId);

    if (!confirm("Are you sure you want to resolve this incident?")) {
        return;
    }

    try {
        await api("/api/resolve/" + encodeURIComponent(id), {
            method: "POST",
            body: JSON.stringify({})
        });

        await loadAdmin();
    } catch (error) {
        showMessage("adminMessage", error.message, true);
    }
}

// PAGE INITIALIZATION
document.addEventListener("DOMContentLoaded", () => {
    $("registerForm")?.addEventListener("submit", registerUser);
    $("sosButton")?.addEventListener("click", activateSOS);
    $("refreshUserButton")?.addEventListener("click", loadUserIncidents);
    $("refreshAdminButton")?.addEventListener("click", loadAdmin);

    if ($("userIncidents")) {
        const user = getSavedUser();

        if (user) {
            $("registeredUser").textContent = "Registered as: " + user.name;
            loadUserIncidents();
        }
    }

    if ($("adminUsers")) {
        loadAdmin();
    }
});