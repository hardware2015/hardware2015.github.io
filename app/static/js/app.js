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
let activePanel = null;
let hasMoreMessages = Boolean(initialState.has_more_messages);
let isLoadingHistory = false;

function getOldestMessageId() {
    const firstMessage = messagesContainer.firstElementChild;
    if (!firstMessage) {
        return null;
    }
    return Number(firstMessage.dataset.messageId);
}

function setStatus(element, text, isError = false) {
    element.textContent = text;
    element.classList.toggle("error", isError);
}

function transitionTo(nextPanel) {
    if (activePanel === nextPanel) {
        return;
    }

    nextPanel.classList.remove("hidden");

    const previousPanel = activePanel;
    activePanel = nextPanel;

    if (previousPanel) {
        previousPanel.classList.remove("panel-visible");
        window.setTimeout(() => {
            if (activePanel !== previousPanel) {
                previousPanel.classList.add("hidden");
            }
        }, 220);
    }

    requestAnimationFrame(() => {
        nextPanel.classList.add("panel-visible");
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
    body.textContent = message.body;

    card.append(top, body);

    if (currentUser && (currentUser.role === "admin" || currentUser.id === message.user.id)) {
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

function prependMessages(messages) {
    const previousHeight = messagesContainer.scrollHeight;
    const fragment = document.createDocumentFragment();
    for (const message of messages) {
        fragment.append(createMessageCard(message));
    }
    messagesContainer.prepend(fragment);
    const nextHeight = messagesContainer.scrollHeight;
    messagesContainer.scrollTop = nextHeight - previousHeight;
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

function removeMessage(messageId) {
    const existing = messagesContainer.querySelector(`[data-message-id="${messageId}"]`);
    if (existing) {
        existing.remove();
    }
}

async function loadMessages(beforeId = null, preserveScroll = false) {
    const query = beforeId ? `?before_id=${encodeURIComponent(beforeId)}` : "";
    const response = await fetch(`/api/messages${query}`);
    if (!response.ok) {
        const payload = await response.json().catch(() => ({ detail: "Failed to load messages" }));
        throw new Error(payload.detail || "Failed to load messages");
    }
    const payload = await response.json();
    hasMoreMessages = Boolean(payload.has_more_messages);

    if (preserveScroll) {
        prependMessages(payload.messages);
    } else {
        renderMessages(payload.messages);
    }
}

async function loadOlderMessages() {
    if (!hasMoreMessages || isLoadingHistory) {
        return;
    }

    const oldestMessageId = getOldestMessageId();
    if (!oldestMessageId) {
        return;
    }

    isLoadingHistory = true;
    setStatus(chatStatus, "loading older messages...", false);

    try {
        await loadMessages(oldestMessageId, true);
        setStatus(chatStatus, "", false);
    } catch (error) {
        setStatus(chatStatus, error.message || "Failed to load messages", true);
    } finally {
        isLoadingHistory = false;
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
        if (payload.type === "message_created") {
            upsertMessage(payload.message);
        }
        if (payload.type === "message_deleted") {
            removeMessage(payload.message_id);
        }
        if (payload.type === "error") {
            setStatus(chatStatus, payload.detail || "error", true);
        }
    });
}

async function activateChat(user, shouldLoadMessages = true) {
    currentUser = user;
    userMeta.textContent = `${user.display_name} / ${user.buc_id}`;
    transitionTo(chatPanel);
    if (shouldLoadMessages) {
        try {
            await loadMessages();
        } catch (error) {
            setStatus(chatStatus, error.message || "Failed to load messages", true);
        }
    }
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
        await activateChat(payload.user, true);
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

messagesContainer.addEventListener("scroll", () => {
    if (messagesContainer.scrollTop <= 20) {
        void loadOlderMessages();
    }
});

if (initialState.authenticated && currentUser) {
    renderMessages(initialState.messages);
    void activateChat(currentUser, false);
} else {
    heroPanel.classList.remove("hidden");
    heroPanel.classList.add("panel-visible");
    activePanel = heroPanel;
    renderMessages([]);
}
