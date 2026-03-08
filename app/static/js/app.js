const stateElement = document.getElementById("page-state");
const initialState = JSON.parse(stateElement.textContent);

const heroPanel = document.querySelector("[data-hero]");
const loginPanel = document.querySelector("[data-login-panel]");
const chatPanel = document.querySelector("[data-chat-panel]");
const enterButton = document.querySelector("[data-enter-button]");
const loginForm = document.querySelector("[data-login-form]");
const loginStatus = document.querySelector("[data-login-status]");
const logoutButton = document.querySelector("[data-logout-button]");
const messageForm = document.querySelector("[data-message-form]");
const chatStatus = document.querySelector("[data-chat-status]");
const messagesContainer = document.querySelector("[data-messages]");
const userMeta = document.querySelector("[data-user-meta]");

let currentUser = initialState.user;
let socket = null;

function setStatus(element, text, isError = false) {
    element.textContent = text;
    element.classList.toggle("error", isError);
}

function transitionTo(nextPanel) {
    for (const panel of [heroPanel, loginPanel, chatPanel]) {
        if (!panel || panel === nextPanel) {
            continue;
        }
        panel.classList.add("panel-leaving");
        window.setTimeout(() => {
            panel.classList.add("hidden");
            panel.classList.remove("panel-leaving");
        }, 240);
    }

    nextPanel.classList.remove("hidden");
    nextPanel.classList.add("panel-leaving");
    requestAnimationFrame(() => {
        nextPanel.classList.remove("panel-leaving");
    });
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString();
}

function createMessageCard(message) {
    const card = document.createElement("article");
    card.className = "message-card";
    card.dataset.messageId = String(message.id);

    const top = document.createElement("div");
    top.className = "message-top";

    const author = document.createElement("div");
    author.className = "message-author";
    author.textContent = message.user.display_name;
    author.style.color = message.user.color || "#f5f5f5";

    const time = document.createElement("div");
    time.className = "message-time";
    time.textContent = formatDate(message.created_at);

    top.append(author, time);

    const body = document.createElement("div");
    body.className = "message-body";

    if (message.deleted_at) {
        body.classList.add("message-deleted");
        body.textContent = "message deleted";
    } else {
        body.textContent = message.body;
    }

    card.append(top, body);

    if (currentUser && !message.deleted_at && (currentUser.role === "admin" || currentUser.id === message.user.id)) {
        const actions = document.createElement("div");
        actions.className = "message-actions";

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "message-delete";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", () => deleteMessage(message.id));

        actions.append(deleteButton);
        card.append(actions);
    }

    return card;
}

function renderMessages(messages) {
    messagesContainer.innerHTML = "";
    for (const message of messages) {
        messagesContainer.append(createMessageCard(message));
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function upsertMessage(message) {
    const existing = messagesContainer.querySelector(`[data-message-id="${message.id}"]`);
    const nextNode = createMessageCard(message);
    if (existing) {
        existing.replaceWith(nextNode);
    } else {
        messagesContainer.append(nextNode);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

async function login(formData) {
    const response = await fetch("/api/login", {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        const payload = await response.json().catch(() => ({ detail: "Login failed" }));
        throw new Error(payload.detail || "Login failed");
    }

    return response.json();
}

async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.reload();
}

async function deleteMessage(messageId) {
    const response = await fetch(`/api/messages/${messageId}`, {
        method: "DELETE",
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => ({ detail: "Delete failed" }));
        setStatus(chatStatus, payload.detail || "Delete failed", true);
        return;
    }
    setStatus(chatStatus, "", false);
}

function connectSocket() {
    if (!currentUser) {
        return;
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${protocol}://${window.location.host}/ws/chat`);

    socket.addEventListener("open", () => {
        setStatus(chatStatus, "connected", false);
    });

    socket.addEventListener("close", () => {
        setStatus(chatStatus, "disconnected", true);
    });

    socket.addEventListener("message", (event) => {
        const payload = JSON.parse(event.data);
        if (payload.type === "message_created" || payload.type === "message_deleted") {
            upsertMessage(payload.message);
        }
        if (payload.type === "error") {
            setStatus(chatStatus, payload.detail || "error", true);
        }
    });
}

function activateChat(user) {
    currentUser = user;
    userMeta.textContent = `${user.display_name} / ${user.buc_id}`;
    transitionTo(chatPanel);
    connectSocket();
}

enterButton.addEventListener("click", () => {
    transitionTo(loginPanel);
});

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(loginStatus, "authenticating...", false);

    try {
        const formData = new FormData(loginForm);
        const payload = await login(formData);
        setStatus(loginStatus, "", false);
        activateChat(payload.user);
    } catch (error) {
        setStatus(loginStatus, error.message || "Login failed", true);
    }
});

logoutButton.addEventListener("click", logout);

messageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        setStatus(chatStatus, "chat connection is not ready", true);
        return;
    }

    const formData = new FormData(messageForm);
    const body = String(formData.get("body") || "").trim();
    if (!body) {
        return;
    }

    socket.send(JSON.stringify({ action: "send_message", body }));
    messageForm.reset();
    setStatus(chatStatus, "", false);
});

if (initialState.authenticated && currentUser) {
    renderMessages(initialState.messages);
    activateChat(currentUser);
} else {
    renderMessages([]);
}
