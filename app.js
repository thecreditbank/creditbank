// ==================== DATABASE VIA CLOUDFLARE WORKER ====================
// All reads/writes go through our Cloudflare Worker proxy
// No token needed for users — the Worker holds the secret!

const WORKER_URL = 'https://creditbank-api.ejrecess.workers.dev';

let dbCache = null;
let dbSha = null;

function getGithubToken() { return ''; }
function setGithubToken(token) { }
function requireToken() { return true; }

// ==================== DATABASE FUNCTIONS ====================
async function getDB() {
    if (dbCache) return dbCache;
    
    try {
        const response = await fetch(WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'read' })
        });
        
        if (response.ok) {
            const data = await response.json();
            dbSha = data.sha;
            dbCache = data.content;
            // Ensure arrays exist
            if (!dbCache.posts) dbCache.posts = [];
            if (!dbCache.comments) dbCache.comments = [];
            if (!dbCache.transactions) dbCache.transactions = [];
            if (!dbCache.friends) dbCache.friends = [];
            if (!dbCache.dailyRewards) dbCache.dailyRewards = [];
            if (!dbCache.coinflip) dbCache.coinflip = { queue: [], active: {} };
            return dbCache;
        }
    } catch (error) {
        console.error('Error loading database:', error);
    }
    
    // Return default database if error
    return {
        users: {},
        transactions: [],
        friends: [],
        dailyRewards: [],
        posts: [],
        comments: []
    };
}

async function reloadDB() {
    dbCache = null;
    dbSha = null;
    return await getDB();
}

async function saveDB(db) {
    try {
        if (!dbSha) {
            await reloadDB();
        }
        
        const response = await fetch(WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'write',
                content: db,
                sha: dbSha,
                message: 'Update CreditBank database'
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            dbSha = data.sha;
            dbCache = db;
            return true;
        } else {
            console.error('Save failed:', response.status);
            if (response.status === 409) {
                await reloadDB();
                Object.assign(dbCache, db);
                return await saveDB(dbCache);
            }
        }
    } catch (error) {
        console.error('Error saving database:', error);
    }
    return false;
}

function hashPassword(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
        const char = password.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return 'h_' + Math.abs(hash).toString(36);
}

// ==================== GLOBAL VARIABLES ====================
let currentUser = null;
let userData = null;
let currentPostId = null; // For modal

// ==================== TOKEN SETUP (no longer needed) ====================
function saveToken() {
    // Token setup no longer needed - using Cloudflare Worker
    document.getElementById('step-token').style.display = 'none';
    document.getElementById('step-login').style.display = 'block';
}

function changeToken() {
    // No-op - token setup removed
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
    // Hide admin elements initially
    const adminOnlyNav = document.querySelector('.nav-item.admin-only');
    const adminSendNotice = document.getElementById('admin-send-notice');
    if (adminOnlyNav) adminOnlyNav.style.display = 'none';
    if (adminSendNotice) adminSendNotice.style.display = 'none';
    
    // Skip token setup - go straight to login
    document.getElementById('step-token').style.display = 'none';
    document.getElementById('step-login').style.display = 'block';
    
    // Try to auto-login
    await reloadDB();
    const savedUserId = localStorage.getItem('creditbank_user_id');
    if (savedUserId) {
        const db = await getDB();
        if (db.users[savedUserId]) {
            currentUser = savedUserId;
            userData = db.users[savedUserId];
            showDashboard();
            return;
        }
    }
    
    // Setup form handlers
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('register-form').addEventListener('submit', handleRegister);
    
    // Password validation
    document.getElementById('reg-password').addEventListener('input', validatePasswordInput);
    
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            switchTab(item.dataset.tab);
        });
    });
});

// ==================== AUTH FUNCTIONS ====================
function showTab(tab) {
    document.querySelectorAll('.auth-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));
    
    if (tab === 'login') {
        document.querySelectorAll('.auth-tabs .tab-btn')[0].classList.add('active');
        document.getElementById('login-form').classList.add('active');
    } else {
        document.querySelectorAll('.auth-tabs .tab-btn')[1].classList.add('active');
        document.getElementById('register-form').classList.add('active');
    }
    
    clearMessage();
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    
    if (!username || !password) {
        showMessage("Please fill in all fields!", 'error');
        return;
    }
    
    // Always reload from GitHub to get latest users
    const db = await reloadDB();
    console.log('Login: loaded DB, users:', Object.keys(db.users).length);
    
    // Find user by username
    let foundUser = null;
    let foundId = null;
    for (const id in db.users) {
        if (db.users[id].username.toLowerCase() === username.toLowerCase()) {
            foundUser = db.users[id];
            foundId = id;
            break;
        }
    }
    
    if (!foundUser) {
        showMessage("User not found!", 'error');
        return;
    }
    
    const inputHash = hashPassword(password);
    console.log('Login attempt:', username, 'input hash:', inputHash, 'stored hash:', foundUser.password);
    
    if (foundUser.password !== inputHash) {
        showMessage("Wrong password!", 'error');
        return;
    }
    
    currentUser = foundId;
    userData = foundUser;
    localStorage.setItem('creditbank_user_id', currentUser);
    showDashboard();
}

async function handleRegister(e) {
    e.preventDefault();
    
    if (!requireToken()) return;
    
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirm = document.getElementById('reg-confirm').value;
    
    if (!username || !password || !confirm) {
        showMessage("Please fill in all fields!", 'error');
        return;
    }
    
    if (password !== confirm) {
        showMessage("Passwords don't match!", 'error');
        return;
    }
    
    if (username.length < 3) {
        showMessage("Username must be at least 3 characters!", 'error');
        return;
    }
    
    const errors = validatePassword(password);
    if (errors.length > 0) {
        showMessage("Password doesn't meet requirements!", 'error');
        return;
    }
    
    // Always reload from GitHub to get latest users
    const db = await reloadDB();
    console.log('Register: loaded DB, users:', Object.keys(db.users).length);
    
    // Check if username exists
    for (const id in db.users) {
        if (db.users[id].username.toLowerCase() === username.toLowerCase()) {
            showMessage("Username already taken!", 'error');
            return;
        }
    }
    
    // Create user
    const userId = 'user_' + Date.now();
    const hashedPw = hashPassword(password);
    console.log('Registering:', username, 'hash:', hashedPw);
    
    db.users[userId] = {
        id: userId,
        username: username,
        password: hashedPw,
        balance: 100,
        totalEarned: 100,
        totalSent: 0,
        totalReceived: 0,
        isAdmin: false,
        createdAt: new Date().toISOString()
    };
    
    // Ensure arrays exist
    if (!db.posts) db.posts = [];
    if (!db.comments) db.comments = [];
    if (!db.transactions) db.transactions = [];
    if (!db.friends) db.friends = [];
    if (!db.dailyRewards) db.dailyRewards = [];
    if (!db.coinflip) db.coinflip = { queue: [], active: {} };
    
    // Add welcome bonus transaction
    db.transactions.push({
        toUserId: userId,
        amount: 100,
        type: 'bonus',
        description: 'Welcome bonus!',
        createdAt: new Date().toISOString()
    });
    
    const saved = await saveDB(db);
    console.log('Register save result:', saved);
    
    if (!saved) {
        showMessage("Failed to create account. Try again!", 'error');
        return;
    }
    
    currentUser = userId;
    userData = db.users[userId];
    localStorage.setItem('creditbank_user_id', currentUser);
    showDashboard();
}

function logout() {
    currentUser = null;
    userData = null;
    localStorage.removeItem('creditbank_user_id');
    
    // Hide admin elements
    const adminOnlyNav = document.querySelector('.nav-item.admin-only');
    const adminSendNotice = document.getElementById('admin-send-notice');
    if (adminOnlyNav) adminOnlyNav.style.display = 'none';
    if (adminSendNotice) adminSendNotice.style.display = 'none';
    
    showAuth();
}

// ==================== SCREEN MANAGEMENT ====================
function showAuth() {
    document.getElementById('auth-screen').classList.add('active');
    document.getElementById('dashboard-screen').classList.remove('active');
}

async function showDashboard() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('dashboard-screen').classList.add('active');
    
    // Reload user data from GitHub
    const db = await reloadDB();
    if (db.users[currentUser]) {
        userData = db.users[currentUser];
    }
    
    // Reset admin visibility before updateUI
    const adminOnlyNav = document.querySelector('.nav-item.admin-only');
    const adminSendNotice = document.getElementById('admin-send-notice');
    if (adminOnlyNav) adminOnlyNav.style.display = 'none';
    if (adminSendNotice) adminSendNotice.style.display = 'none';
    
    updateUI();
    await loadFriends();
    await loadLeaderboard();
    await loadHistory();
    await loadFeed();
}

function updateUI() {
    if (!userData) return;
    
    document.getElementById('user-name').textContent = userData.username;
    document.getElementById('user-avatar').textContent = userData.username[0].toUpperCase();
    document.getElementById('user-balance').textContent = `${formatNumber(userData.balance)} credits`;
    document.getElementById('welcome-name').textContent = userData.username;
    
    document.getElementById('stat-balance').textContent = formatNumber(userData.balance);
    document.getElementById('stat-earned').textContent = formatNumber(userData.totalEarned);
    document.getElementById('stat-sent').textContent = formatNumber(userData.totalSent);
    document.getElementById('stat-received').textContent = formatNumber(userData.totalReceived);
    
    // Handle admin-only elements
    const adminOnlyNav = document.querySelector('.nav-item.admin-only');
    const adminSendNotice = document.getElementById('admin-send-notice');
    
    if (userData.isAdmin) {
        if (adminOnlyNav) adminOnlyNav.style.display = 'flex';
        if (adminSendNotice) adminSendNotice.style.display = 'flex';
    } else {
        if (adminOnlyNav) adminOnlyNav.style.display = 'none';
        if (adminSendNotice) adminSendNotice.style.display = 'none';
    }
}

function switchTab(tab) {
    // Stop coinflip polling when leaving
    if (coinflipPollInterval) {
        clearInterval(coinflipPollInterval);
        coinflipPollInterval = null;
    }
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.tab === tab) item.classList.add('active');
    });
    
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    
    if (tab === 'friends') loadFriends();
    if (tab === 'leaderboard') loadLeaderboard();
    if (tab === 'history') loadHistory();
    if (tab === 'admin') loadAdminData();
    if (tab === 'feed') loadFeed();
    if (tab === 'coinflip') loadCoinFlip();
}

// ==================== SEND CREDITS ====================
async function sendCredits() {
    if (!requireToken()) return;
    
    const recipient = document.getElementById('send-username').value.trim();
    const amount = parseInt(document.getElementById('send-amount').value);
    
    if (!recipient || !amount) {
        showToast('Please fill in all fields', 'error');
        return;
    }
    
    if (amount <= 0) {
        showToast('Amount must be positive', 'error');
        return;
    }
    
    // Reload from GitHub
    const db = await reloadDB();
    
    let recipientUser = null;
    let recipientId = null;
    for (const id in db.users) {
        if (db.users[id].username.toLowerCase() === recipient.toLowerCase()) {
            recipientUser = db.users[id];
            recipientId = id;
            break;
        }
    }
    
    if (!recipientUser) {
        showToast('User not found!', 'error');
        return;
    }
    
    if (recipientId === currentUser) {
        showToast("You can't send credits to yourself!", 'error');
        return;
    }
    
    // Reload current user data
    userData = db.users[currentUser];
    
    if (userData.balance < amount) {
        showToast('Insufficient balance!', 'error');
        return;
    }
    
    if (!userData.isAdmin) {
        const isFriend = db.friends.some(f => 
            (f.userId === currentUser && f.friendId === recipientId && f.status === 'accepted') ||
            (f.userId === recipientId && f.friendId === currentUser && f.status === 'accepted')
        );
        
        if (!isFriend) {
            showToast('You can only send to accepted friends!', 'error');
            return;
        }
    }
    
    db.users[currentUser].balance -= amount;
    db.users[currentUser].totalSent += amount;
    db.users[recipientId].balance += amount;
    db.users[recipientId].totalReceived += amount;
    
    db.transactions.push({
        fromUserId: currentUser,
        toUserId: recipientId,
        amount: amount,
        type: userData.isAdmin ? 'admin_transfer' : 'transfer',
        description: `Transfer to ${recipientUser.username}`,
        createdAt: new Date().toISOString()
    });
    
    await saveDB(db);
    userData = db.users[currentUser];
    
    showToast(`Sent ${amount} credits to ${recipientUser.username}!`, 'success');
    
    document.getElementById('send-username').value = '';
    document.getElementById('send-amount').value = '';
    updateUI();
}

// ==================== FRIENDS ====================
async function loadFriends() {
    // Reload from GitHub
    const db = await reloadDB();
    
    const pending = db.friends.filter(f => f.friendId === currentUser && f.status === 'pending');
    const pendingList = document.getElementById('pending-list');
    pendingList.innerHTML = '';
    document.getElementById('pending-count').textContent = pending.length;
    
    pending.forEach(f => {
        const user = db.users[f.userId];
        if (user) {
            pendingList.innerHTML += `
                <div class="user-item">
                    <div class="user-item-left">
                        <div class="user-item-avatar">${user.username[0].toUpperCase()}</div>
                        <div class="user-item-name">${user.username}</div>
                    </div>
                    <div class="user-item-right">
                        <button class="btn-primary btn-small" onclick="acceptFriend('${f.userId}')">Accept</button>
                    </div>
                </div>
            `;
        }
    });
    
    if (pending.length === 0) {
        pendingList.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">No pending requests</p>';
    }
    
    const friends = db.friends.filter(f => 
        (f.userId === currentUser || f.friendId === currentUser) && f.status === 'accepted'
    );
    
    const friendsList = document.getElementById('friends-list');
    friendsList.innerHTML = '';
    document.getElementById('friends-count').textContent = friends.length;
    
    friends.forEach(f => {
        const friendId = f.userId === currentUser ? f.friendId : f.userId;
        const user = db.users[friendId];
        if (user) {
            friendsList.innerHTML += `
                <div class="user-item">
                    <div class="user-item-left">
                        <div class="user-item-avatar">${user.username[0].toUpperCase()}</div>
                        <div class="user-item-name">${user.username}</div>
                    </div>
                    <div class="user-item-right">
                        <span class="user-item-balance">${formatNumber(user.balance)} credits</span>
                    </div>
                </div>
            `;
        }
    });
    
    if (friends.length === 0) {
        friendsList.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">No friends yet. Add some!</p>';
    }
}

async function addFriend() {
    if (!requireToken()) return;
    
    const input = document.getElementById('add-friend-input');
    const target = input.value.trim();
    
    if (!target) {
        showToast('Please enter a username', 'error');
        return;
    }
    
    // Reload from GitHub
    const db = await reloadDB();
    
    let targetUser = null;
    let targetId = null;
    for (const id in db.users) {
        if (db.users[id].username.toLowerCase() === target.toLowerCase()) {
            targetUser = db.users[id];
            targetId = id;
            break;
        }
    }
    
    if (!targetUser) {
        showToast('User not found!', 'error');
        return;
    }
    
    if (targetId === currentUser) {
        showToast("You can't add yourself!", 'error');
        return;
    }
    
    const existing = db.friends.some(f => 
        (f.userId === currentUser && f.friendId === targetId) ||
        (f.userId === targetId && f.friendId === currentUser)
    );
    
    if (existing) {
        showToast('Friend request already exists!', 'error');
        return;
    }
    
    db.friends.push({
        userId: currentUser,
        friendId: targetId,
        status: 'pending',
        createdAt: new Date().toISOString()
    });
    
    await saveDB(db);
    showToast(`Friend request sent to ${targetUser.username}!`, 'success');
    input.value = '';
    await loadFriends();
}

async function acceptFriend(friendUserId) {
    // Reload from GitHub
    const db = await reloadDB();
    
    const request = db.friends.find(f => f.userId === friendUserId && f.friendId === currentUser && f.status === 'pending');
    if (request) {
        request.status = 'accepted';
    }
    
    const reverseExists = db.friends.some(f => f.userId === currentUser && f.friendId === friendUserId);
    if (!reverseExists) {
        db.friends.push({
            userId: currentUser,
            friendId: friendUserId,
            status: 'accepted',
            createdAt: new Date().toISOString()
        });
    }
    
    await saveDB(db);
    showToast('Friend request accepted!', 'success');
    await loadFriends();
}

// ==================== LEADERBOARD ====================
async function loadLeaderboard() {
    // Reload from GitHub
    const db = await reloadDB();
    
    const allUsers = Object.values(db.users).sort((a, b) => b.balance - a.balance).slice(0, 10);
    const globalList = document.getElementById('global-leaderboard');
    globalList.innerHTML = '';
    
    allUsers.forEach((user, index) => {
        const rank = index + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
        const adminTag = user.isAdmin ? '<span class="admin-tag">(admin)</span>' : '';
        
        globalList.innerHTML += `
            <div class="leaderboard-item">
                <span class="leaderboard-rank">${medal}</span>
                <div class="leaderboard-user">${user.username} ${adminTag}</div>
                <span class="leaderboard-balance">${formatNumber(user.balance)}</span>
            </div>
        `;
    });
    
    const friendsList = document.getElementById('friends-leaderboard');
    friendsList.innerHTML = '';
    
    friendsList.innerHTML += `
        <div class="leaderboard-item">
            <span class="leaderboard-rank">-</span>
            <div class="leaderboard-user">
                ${userData.username} <span class="you-tag">(YOU)</span>
                ${userData.isAdmin ? '<span class="admin-tag">(admin)</span>' : ''}
            </div>
            <span class="leaderboard-balance">${formatNumber(userData.balance)}</span>
        </div>
    `;
    
    const friendIds = new Set();
    db.friends.forEach(f => {
        if ((f.userId === currentUser || f.friendId === currentUser) && f.status === 'accepted') {
            friendIds.add(f.userId === currentUser ? f.friendId : f.userId);
        }
    });
    
    Array.from(friendIds)
        .map(id => db.users[id])
        .filter(u => u)
        .sort((a, b) => b.balance - a.balance)
        .forEach((user, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
            const adminTag = user.isAdmin ? '<span class="admin-tag">(admin)</span>' : '';
            
            friendsList.innerHTML += `
                <div class="leaderboard-item">
                    <span class="leaderboard-rank">${medal}</span>
                    <div class="leaderboard-user">${user.username} ${adminTag}</div>
                    <span class="leaderboard-balance">${formatNumber(user.balance)}</span>
                </div>
            `;
        });
}

function showLeaderboard(type) {
    document.querySelectorAll('.leaderboard-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.leaderboard-list').forEach(list => list.classList.remove('active'));
    
    if (type === 'global') {
        document.querySelectorAll('.leaderboard-tabs .tab-btn')[0].classList.add('active');
        document.getElementById('global-leaderboard').classList.add('active');
    } else {
        document.querySelectorAll('.leaderboard-tabs .tab-btn')[1].classList.add('active');
        document.getElementById('friends-leaderboard').classList.add('active');
    }
}

// ==================== HISTORY ====================
async function loadHistory() {
    // Reload from GitHub
    const db = await reloadDB();
    
    const transactions = db.transactions.filter(t => 
        t.fromUserId === currentUser || t.toUserId === currentUser
    ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20);
    
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '';
    
    if (transactions.length === 0) {
        historyList.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">No transactions yet!</p>';
        return;
    }
    
    transactions.forEach(tx => {
        const isSystem = tx.type === 'bonus' || tx.type === 'reward' || tx.type === 'task';
        const isSent = tx.fromUserId === currentUser;
        let cssClass = isSystem ? 'system' : (isSent ? 'sent' : 'received');
        let directionText = isSystem ? '📥 System' : (isSent ? '📤 Sent' : '📥 Received');
        
        historyList.innerHTML += `
            <div class="history-item ${cssClass}">
                <div class="history-direction">${directionText} ${formatNumber(tx.amount)} credits</div>
                <div class="history-info">${tx.description}</div>
            </div>
        `;
    });
}

// ==================== BAD WORD FILTER ====================
const badWords = ['fuck', 'shit', 'ass', 'bitch', 'damn', 'crap', 'dick', 'cock', 'pussy', 'asshole', 'bastard', 'slut', 'whore', 'nigger', 'fag', 'retard', 'cunt'];

function containsBadWords(text) {
    const lower = text.toLowerCase();
    const found = [];
    for (const word of badWords) {
        if (lower.includes(word)) {
            found.push(word);
        }
    }
    return found;
}

// ==================== FEED / POSTS ====================
let currentModalPostId = null;

async function loadFeed() {
    // Always reload from GitHub to get latest posts
    const db = await reloadDB();
    
    const posts = (db.posts || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const feedEl = document.getElementById('posts-feed');
    feedEl.innerHTML = '';
    
    if (posts.length === 0) {
        feedEl.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 40px;">No posts yet. Be the first to post!</p>';
        return;
    }
    
    posts.forEach(post => {
        const author = db.users[post.authorId];
        if (!author) return;
        
        const commentCount = (db.comments || []).filter(c => c.postId === post.id).length;
        const timeAgo = getTimeAgo(post.createdAt);
        const adminTag = author.isAdmin ? '<span class="admin-tag" style="color: var(--warning); font-size: 11px; margin-left: 6px;">(admin)</span>' : '';
        
        feedEl.innerHTML += `
            <div class="post-card" onclick="openPost('${post.id}')">
                <div class="post-header">
                    <div class="post-avatar">${author.username[0].toUpperCase()}</div>
                    <div class="post-author-info">
                        <span class="post-author-name">${author.username}${adminTag}</span>
                        <span class="post-time">${timeAgo}</span>
                    </div>
                </div>
                <div class="post-content">${escapeHtml(post.content)}</div>
                <div class="post-stats">
                    <span class="post-stat"><i class="fas fa-comment"></i> ${commentCount} comment${commentCount !== 1 ? 's' : ''}</span>
                    <span class="post-stat"><i class="fas fa-donate"></i> Donate credits</span>
                </div>
            </div>
        `;
    });
}

async function createPost() {
    if (!requireToken()) return;
    
    const content = document.getElementById('post-content').value.trim();
    
    if (!content) {
        showToast('Please write something!', 'error');
        return;
    }
    
    if (content.length > 500) {
        showToast('Post too long! Max 500 characters.', 'error');
        return;
    }
    
    // Bad word check
    const badFound = containsBadWords(content);
    if (badFound.length > 0) {
        const proceed = confirm(`⚠️ Warning: Your post may contain inappropriate language (${badFound.join(', ')}).\n\nDo you still want to post it?`);
        if (!proceed) return;
    }
    
    const token = getGithubToken();
    
    try {
        // Get fresh database
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${DB_FILE}`, {
            headers: { 'Accept': 'application/vnd.github.v3+json' }
        });
        
        if (!response.ok) {
            showToast('Failed to load database!', 'error');
            return;
        }
        
        const data = await response.json();
        const content2 = decodeURIComponent(escape(atob(data.content)));
        const db = JSON.parse(content2);
        
        if (!db.posts) db.posts = [];
        
        const newPost = {
            id: 'post_' + Date.now(),
            authorId: currentUser,
            content: content,
            createdAt: new Date().toISOString()
        };
        
        db.posts.push(newPost);
        
        // Save back
        const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(db, null, 2))));
        const saveResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${DB_FILE}`, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: 'New post',
                content: encoded,
                sha: data.sha
            })
        });
        
        if (saveResponse.ok) {
            dbCache = db;
            document.getElementById('post-content').value = '';
            showToast('Post created!', 'success');
            await loadFeed();
        } else {
            const err = await saveResponse.json();
            console.error('Save failed:', err);
            showToast('Failed to save post! ' + (saveResponse.status === 401 ? 'Token expired.' : ''), 'error');
        }
    } catch (error) {
        console.error('Post error:', error);
        showToast('Error creating post!', 'error');
    }
}

function openPost(postId) {
    currentModalPostId = postId;
    
    // Hide all sections
    document.getElementById('comment-input-section').style.display = 'none';
    document.getElementById('comments-section').style.display = 'none';
    document.getElementById('donate-input-section').style.display = 'none';
    
    // Show modal
    document.getElementById('post-modal').style.display = 'flex';
    
    loadPostModal();
}

async function loadPostModal() {
    const db = await getDB();
    const post = (db.posts || []).find(p => p.id === currentModalPostId);
    
    if (!post) {
        closePostModal();
        return;
    }
    
    const author = db.users[post.authorId];
    if (!author) {
        closePostModal();
        return;
    }
    
    document.getElementById('modal-post-author').textContent = `Post by ${author.username}`;
    document.getElementById('modal-post-content').textContent = post.content;
    document.getElementById('modal-post-time').textContent = getTimeAgo(post.createdAt);
}

function closePostModal() {
    document.getElementById('post-modal').style.display = 'none';
    currentModalPostId = null;
}

function showCommentInput() {
    document.getElementById('comment-input-section').style.display = 'block';
    document.getElementById('comments-section').style.display = 'none';
    document.getElementById('donate-input-section').style.display = 'none';
    document.getElementById('comment-input').value = '';
    document.getElementById('comment-input').focus();
}

async function submitComment() {
    if (!requireToken()) return;
    
    const content = document.getElementById('comment-input').value.trim();
    
    if (!content) {
        showToast('Please write a comment!', 'error');
        return;
    }
    
    // Reload from GitHub
    const db = await reloadDB();
    
    if (!db.comments) db.comments = [];
    
    const newComment = {
        id: 'comment_' + Date.now(),
        postId: currentModalPostId,
        authorId: currentUser,
        content: content,
        createdAt: new Date().toISOString()
    };
    
    db.comments.push(newComment);
    
    const saved = await saveDB(db);
    if (!saved) {
        showToast('Failed to save comment. Try again!', 'error');
        return;
    }
    
    document.getElementById('comment-input').value = '';
    showToast('Comment posted!', 'success');
    
    // Refresh comments view
    await viewComments();
}

async function viewComments() {
    document.getElementById('comment-input-section').style.display = 'none';
    document.getElementById('comments-section').style.display = 'block';
    document.getElementById('donate-input-section').style.display = 'none';
    
    // Reload from GitHub
    const db = await reloadDB();
    const comments = (db.comments || [])
        .filter(c => c.postId === currentModalPostId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    const commentsList = document.getElementById('comments-list');
    
    if (comments.length === 0) {
        commentsList.innerHTML = '<p class="no-comments">No comments yet. Be the first!</p>';
        return;
    }
    
    commentsList.innerHTML = '';
    
    comments.forEach(comment => {
        const author = db.users[comment.authorId];
        if (!author) return;
        
        commentsList.innerHTML += `
            <div class="comment-item">
                <div class="comment-avatar">${author.username[0].toUpperCase()}</div>
                <div class="comment-body">
                    <div class="comment-author">${author.username}</div>
                    <div class="comment-text">${escapeHtml(comment.content)}</div>
                    <div class="comment-time">${getTimeAgo(comment.createdAt)}</div>
                </div>
            </div>
        `;
    });
}

function showDonateInput() {
    document.getElementById('comment-input-section').style.display = 'none';
    document.getElementById('comments-section').style.display = 'none';
    document.getElementById('donate-input-section').style.display = 'block';
    document.getElementById('donate-amount').value = '';
    document.getElementById('donate-amount').focus();
}

async function submitDonate() {
    if (!requireToken()) return;
    
    const amount = parseInt(document.getElementById('donate-amount').value);
    
    if (!amount || amount <= 0) {
        showToast('Enter a valid amount!', 'error');
        return;
    }
    
    // Reload from GitHub
    const db = await reloadDB();
    const post = (db.posts || []).find(p => p.id === currentModalPostId);
    
    if (!post) {
        showToast('Post not found!', 'error');
        return;
    }
    
    const recipientId = post.authorId;
    
    if (recipientId === currentUser) {
        showToast("You can't donate to yourself!", 'error');
        return;
    }
    
    if (userData.balance < amount) {
        showToast('Insufficient balance!', 'error');
        return;
    }
    
    // Transfer credits
    db.users[currentUser].balance -= amount;
    db.users[currentUser].totalSent += amount;
    db.users[recipientId].balance += amount;
    db.users[recipientId].totalReceived += amount;
    
    const recipient = db.users[recipientId];
    
    db.transactions.push({
        fromUserId: currentUser,
        toUserId: recipientId,
        amount: amount,
        type: 'donate',
        description: `Donation to ${recipient.username}'s post`,
        createdAt: new Date().toISOString()
    });
    
    await saveDB(db);
    userData = db.users[currentUser];
    
    showToast(`Donated ${amount} credits to ${recipient.username}!`, 'success');
    document.getElementById('donate-amount').value = '';
    updateUI();
}

function getTimeAgo(dateString) {
    const now = new Date();
    const date = new Date(dateString);
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== ADMIN FUNCTIONS ====================
function showAdminTab(tab) {
    document.querySelectorAll('.admin-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.admin-panel').forEach(panel => panel.classList.remove('active'));
    
    const tabs = ['give', 'set', 'users'];
    const index = tabs.indexOf(tab);
    document.querySelectorAll('.admin-tabs .tab-btn')[index].classList.add('active');
    document.getElementById(`admin-${tab}`).classList.add('active');
}

async function adminGiveCredits() {
    const target = document.getElementById('admin-give-user').value.trim();
    const amount = parseInt(document.getElementById('admin-give-amount').value);
    
    if (!target || !amount) {
        showToast('Please fill in all fields', 'error');
        return;
    }
    
    // Reload from GitHub
    const db = await reloadDB();
    
    let targetUser = null;
    let targetId = null;
    for (const id in db.users) {
        if (db.users[id].username.toLowerCase() === target.toLowerCase()) {
            targetUser = db.users[id];
            targetId = id;
            break;
        }
    }
    
    if (!targetUser) {
        showToast('User not found!', 'error');
        return;
    }
    
    db.users[targetId].balance += amount;
    db.users[targetId].totalReceived += amount;
    
    db.transactions.push({
        toUserId: targetId,
        amount: amount,
        type: 'admin_grant',
        description: 'Admin grant',
        createdAt: new Date().toISOString()
    });
    
    await saveDB(db);
    showToast(`Gave ${amount} credits to ${targetUser.username}!`, 'success');
    document.getElementById('admin-give-user').value = '';
    document.getElementById('admin-give-amount').value = '';
}

async function adminGiveSelf() {
    const amount = parseInt(document.getElementById('admin-give-amount').value);
    
    if (!amount) {
        showToast('Enter an amount first!', 'error');
        return;
    }
    
    // Reload from GitHub
    const db = await reloadDB();
    db.users[currentUser].balance += amount;
    db.users[currentUser].totalReceived += amount;
    
    db.transactions.push({
        toUserId: currentUser,
        amount: amount,
        type: 'admin_grant',
        description: 'Admin self-grant',
        createdAt: new Date().toISOString()
    });
    
    await saveDB(db);
    userData = db.users[currentUser];
    showToast(`Added ${amount} credits to yourself!`, 'success');
    updateUI();
    document.getElementById('admin-give-amount').value = '';
}

async function adminSetBalance() {
    const target = document.getElementById('admin-set-user').value.trim();
    const amount = parseInt(document.getElementById('admin-set-amount').value);
    
    if (!target || amount === undefined) {
        showToast('Please fill in all fields', 'error');
        return;
    }
    
    // Reload from GitHub
    const db = await reloadDB();
    
    let targetUser = null;
    let targetId = null;
    for (const id in db.users) {
        if (db.users[id].username.toLowerCase() === target.toLowerCase()) {
            targetUser = db.users[id];
            targetId = id;
            break;
        }
    }
    
    if (!targetUser) {
        showToast('User not found!', 'error');
        return;
    }
    
    db.users[targetId].balance = amount;
    
    db.transactions.push({
        toUserId: targetId,
        amount: amount,
        type: 'admin_set',
        description: 'Admin balance set',
        createdAt: new Date().toISOString()
    });
    
    await saveDB(db);
    showToast(`Set ${targetUser.username}'s balance to ${amount}!`, 'success');
    document.getElementById('admin-set-user').value = '';
    document.getElementById('admin-set-amount').value = '';
}

async function loadAdminData() {
    // Reload from GitHub
    const db = await reloadDB();
    
    const allUsers = Object.values(db.users).sort((a, b) => b.balance - a.balance);
    const usersList = document.getElementById('all-users-list');
    usersList.innerHTML = '';
    
    allUsers.forEach(user => {
        const adminTag = user.isAdmin ? '<span class="admin-tag">(admin)</span>' : '';
        
        usersList.innerHTML += `
            <div class="user-item">
                <div class="user-item-left">
                    <div class="user-item-avatar">${user.username[0].toUpperCase()}</div>
                    <div class="user-item-name">${user.username} ${adminTag}</div>
                </div>
                <div class="user-item-right">
                    <span class="user-item-balance">${formatNumber(user.balance)} credits</span>
                </div>
            </div>
        `;
    });
}

// ==================== ADMIN BUTTON ====================
async function promptAdmin() {
    const password = prompt('Enter admin password:');
    
    if (password === null) return; // Cancelled
    
    if (password !== 'opencode') {
        showToast('Wrong password!', 'error');
        return;
    }
    
    // Give admin powers
    const db = await getDB();
    if (db.users[currentUser]) {
        db.users[currentUser].isAdmin = true;
        await saveDB(db);
        userData = db.users[currentUser];
        updateUI();
        showToast('Admin mode activated!', 'success');
    }
}

// ==================== COIN FLIP ====================
// Multiplayer coin flip game using GitHub database as shared state
// Players join a queue, get matched, set a bet, and flip a coin.
// Winner takes both bets (net gain = opponent's bet amount).

let coinflipPollInterval = null;

async function loadCoinFlip() {
    if (!currentUser) return;
    resetCoinFlipUI();
    await checkCoinFlipQueue();
    // Poll every 2 seconds for matches (only in multiplayer mode)
    if (coinflipPollInterval) clearInterval(coinflipPollInterval);
    const multiMode = document.getElementById('coinflip-multi');
    if (multiMode && multiMode.style.display !== 'none') {
        coinflipPollInterval = setInterval(checkCoinFlipQueue, 2000);
    }
}

function resetCoinFlipUI() {
    document.getElementById('coinflip-waiting').classList.add('active');
    document.getElementById('coinflip-matched').classList.remove('active');
    document.getElementById('coinflip-bet-section').style.display = '';
    document.getElementById('coinflip-waiting-match').style.display = 'none';
    document.getElementById('coinflip-matching').style.display = 'none';
    document.getElementById('coinflip-waiting-to-match').style.display = 'none';
    document.getElementById('coinflip-flipping').style.display = 'none';
    document.getElementById('coinflip-result').style.display = 'none';
    const coin = document.getElementById('the-coin');
    if (coin) {
        coin.className = 'coin';
    }
}

function resetCoinFlip() {
    resetCoinFlipUI();
}

// ==================== COINFLIP MODE SWITCHING ====================
function switchCoinflipMode(mode) {
    // Update mode buttons
    document.querySelectorAll('.coinflip-mode-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    // Show/hide modes
    document.getElementById('coinflip-multi').style.display = mode === 'multi' ? '' : 'none';
    document.getElementById('coinflip-multi').classList.toggle('active', mode === 'multi');
    document.getElementById('coinflip-risk').style.display = mode === 'risk' ? '' : 'none';
    document.getElementById('coinflip-risk').classList.toggle('active', mode === 'risk');
    
    // Stop multiplayer polling if switching away
    if (mode !== 'multi' && coinflipPollInterval) {
        clearInterval(coinflipPollInterval);
        coinflipPollInterval = null;
    }
    
    // Load risk mode balance
    if (mode === 'risk') loadRiskBalance();
}

async function loadRiskBalance() {
    const db = await reloadDB();
    const user = db.users[currentUser];
    const balance = user ? user.balance : 0;
    document.getElementById('risk-balance').textContent = formatNumber(balance);
}

// ==================== RISK MODE ====================
let riskFlipping = false;

function startRiskFlip(chosenColor) {
    if (riskFlipping) return;
    if (!requireToken()) return;
    
    const balance = userData ? userData.balance : 0;
    if (balance <= 0) {
        showToast('You have no credits to risk!', 'error');
        return;
    }
    
    // Show flipping state
    document.getElementById('risk-choose').style.display = 'none';
    document.getElementById('risk-flipping').style.display = '';
    document.getElementById('risk-result').style.display = 'none';
    
    document.getElementById('risk-chosen-color').textContent = chosenColor === 'yellow' ? '🟡 Yellow' : '🔴 Red';
    document.getElementById('risk-chosen-color').style.color = chosenColor === 'yellow' ? '#EAB308' : '#EF4444';
    document.getElementById('risk-bet-amount').textContent = formatNumber(balance);
    
    // Reset coin
    const coin = document.getElementById('risk-the-coin');
    coin.className = 'coin';
    
    riskFlipping = true;
    
    // Start flip animation
    setTimeout(() => {
        coin.classList.add('flipping');
    }, 100);
    
    // Determine result after animation
    setTimeout(async () => {
        const result = Math.random() < 0.5 ? 'yellow' : 'red';
        const won = result === chosenColor;
        
        coin.classList.remove('flipping');
        coin.classList.add(won ? 'win' : 'lose');
        
        // Process result in database
        const db = await reloadDB();
        const user = db.users[currentUser];
        if (!user) return;
        
        const betAmount = user.balance;
        
        if (won) {
            // Winner gets double (net gain = bet amount)
            user.balance = betAmount * 2;
            user.totalEarned = (user.totalEarned || 0) + betAmount;
        } else {
            // Loser loses everything
            user.balance = 0;
        }
        
        // Record transaction
        if (!db.transactions) db.transactions = [];
        db.transactions.push({
            type: 'risk_flip',
            userId: currentUser,
            bet: betAmount,
            won: won,
            result: result,
            chosenColor: chosenColor,
            payout: won ? betAmount * 2 : 0,
            timestamp: Date.now()
        });
        
        await saveDB(db);
        
        // Reload user data
        const freshDb = await reloadDB();
        userData = freshDb.users[currentUser];
        
        // Show result
        setTimeout(() => {
            document.getElementById('risk-flipping').style.display = 'none';
            document.getElementById('risk-result').style.display = '';
            
            const resultIcon = document.getElementById('risk-result-icon');
            const resultText = document.getElementById('risk-result-text');
            const resultDetail = document.getElementById('risk-result-detail');
            const resultAmount = document.getElementById('risk-result-amount');
            
            resultIcon.textContent = result === 'yellow' ? '🟡' : '🔴';
            
            if (won) {
                resultText.textContent = 'You Won!';
                resultText.style.color = 'var(--success)';
                resultDetail.textContent = `The coin landed on ${result === 'yellow' ? '🟡 Yellow' : '🔴 Red'}!`;
                resultAmount.textContent = `+${formatNumber(betAmount)} credits (doubled!)`;
                resultAmount.style.color = 'var(--success)';
                resultIcon.classList.add('risk-win-glow');
                resultIcon.classList.remove('risk-lose-shake');
            } else {
                resultText.textContent = 'You Lost Everything!';
                resultText.style.color = 'var(--danger)';
                resultDetail.textContent = `The coin landed on ${result === 'yellow' ? '🟡 Yellow' : '🔴 Red'}... you chose ${chosenColor === 'yellow' ? '🟡 Yellow' : '🔴 Red'}.`;
                resultAmount.textContent = `-${formatNumber(betAmount)} credits (all gone)`;
                resultAmount.style.color = 'var(--danger)';
                resultIcon.classList.remove('risk-win-glow');
                resultIcon.classList.add('risk-lose-shake');
            }
            
            riskFlipping = false;
            updateUI();
        }, 400);
    }, 1600);
}

function resetRiskMode() {
    document.getElementById('risk-choose').style.display = '';
    document.getElementById('risk-flipping').style.display = 'none';
    document.getElementById('risk-result').style.display = 'none';
    
    const coin = document.getElementById('risk-the-coin');
    if (coin) coin.className = 'coin';
    
    loadRiskBalance();
}

async function joinCoinFlip() {
    if (!requireToken()) return;
    
    const db = await reloadDB();
    if (!db.coinflip) db.coinflip = { queue: [], active: {} };
    
    // Check if already in queue or in a game
    const inQueue = db.coinflip.queue.find(q => q.username === currentUser);
    const inGame = db.coinflip.active[currentUser];
    if (inQueue || inGame) {
        showToast('You are already in a game!', 'error');
        return;
    }
    
    // Check balance
    const user = db.users[currentUser];
    if (!user || user.balance < 10) {
        showToast('You need at least 10 credits to play!', 'error');
        return;
    }
    
    db.coinflip.queue.push({
        username: currentUser,
        joinedAt: Date.now()
    });
    
    await saveDB(db);
    showToast('Joined the coin flip queue!', 'success');
    await checkCoinFlipQueue();
}

async function checkCoinFlipQueue() {
    if (!currentUser) return;
    
    const db = await reloadDB();
    if (!db.coinflip) db.coinflip = { queue: [], active: {} };
    
    // Check if we're in an active game
    const activeGame = db.coinflip.active[currentUser];
    if (activeGame) {
        await handleActiveGame(db, activeGame);
        return;
    }
    
    // Check queue
    const myQueueEntry = db.coinflip.queue.find(q => q.username === currentUser);
    if (!myQueueEntry) {
        // Not in queue, show waiting screen
        const queueCount = db.coinflip.queue.length;
        document.getElementById('coinflip-queue-count').textContent = 
            queueCount > 0 ? `${queueCount} player(s) in queue` : '';
        resetCoinFlipUI();
        return;
    }
    
    // We're in queue - check for match
    if (db.coinflip.queue.length >= 2) {
        // Match the first two players
        const player1 = db.coinflip.queue.shift();
        const player2 = db.coinflip.queue.shift();
        
        db.coinflip.active[player1.username] = {
            player1: player1.username,
            player2: player2.username,
            bet: 0,
            bet2: 0,
            status: 'setting_bet', // setting_bet, waiting_match, flipping, done
            coinSide: Math.random() < 0.5 ? 'heads' : 'tails',
            createdAt: Date.now()
        };
        db.coinflip.active[player2.username] = db.coinflip.active[player1.username];
        
        await saveDB(db);
        showToast(`Matched with ${player2.username}!`, 'success');
        await handleActiveGame(db, db.coinflip.active[currentUser]);
    } else {
        // Still waiting
        document.getElementById('coinflip-waiting').classList.add('active');
        document.getElementById('coinflip-matched').classList.remove('active');
        document.getElementById('coinflip-queue-count').textContent = 'Waiting for opponent...';
    }
}

async function handleActiveGame(db, game) {
    const isP1 = game.player1 === currentUser;
    
    // Show matched screen
    document.getElementById('coinflip-waiting').classList.remove('active');
    document.getElementById('coinflip-matched').classList.add('active');
    
    // Set player info
    document.getElementById('cf-player1-name').textContent = game.player1;
    document.getElementById('cf-player1-avatar').textContent = game.player1[0].toUpperCase();
    document.getElementById('cf-player2-name').textContent = game.player2;
    document.getElementById('cf-player2-avatar').textContent = game.player2[0].toUpperCase();
    
    const user = db.users[currentUser];
    const balance = user ? user.balance : 0;
    
    if (game.status === 'setting_bet') {
        if (isP1) {
            // Player 1 sets the bet
            document.getElementById('coinflip-bet-section').style.display = '';
            document.getElementById('coinflip-waiting-match').style.display = 'none';
            document.getElementById('coinflip-matching').style.display = 'none';
            document.getElementById('coinflip-waiting-to-match').style.display = 'none';
            document.getElementById('cf-your-balance').textContent = formatNumber(balance);
        } else {
            // Player 2 waits for bet
            document.getElementById('coinflip-bet-section').style.display = 'none';
            document.getElementById('coinflip-waiting-match').style.display = 'none';
            document.getElementById('coinflip-matching').style.display = 'none';
            document.getElementById('coinflip-waiting-to-match').style.display = 'none';
            // Show a waiting message
            document.getElementById('coinflip-bet-section').style.display = 'none';
            const waitDiv = document.getElementById('coinflip-matching');
            waitDiv.innerHTML = '<p style="color: var(--text-secondary); font-size: 16px;">Waiting for opponent to set the bet...</p><div class="spinner"></div>';
            waitDiv.style.display = '';
        }
    } else if (game.status === 'waiting_match') {
        // Bet is set, waiting for P2 to match
        if (!isP1) {
            // Player 2 can match
            document.getElementById('coinflip-bet-section').style.display = 'none';
            document.getElementById('coinflip-waiting-match').style.display = 'none';
            document.getElementById('coinflip-matching').style.display = 'none';
            document.getElementById('coinflip-waiting-to-match').style.display = '';
            document.getElementById('cf-opponent-bet').textContent = formatNumber(game.bet);
            document.getElementById('cf-your-balance2').textContent = formatNumber(balance);
        } else {
            // Player 1 waits for match
            document.getElementById('coinflip-bet-section').style.display = 'none';
            document.getElementById('coinflip-waiting-match').style.display = '';
            document.getElementById('coinflip-bet-display').textContent = formatNumber(game.bet);
            document.getElementById('coinflip-matching').style.display = 'none';
            document.getElementById('coinflip-waiting-to-match').style.display = 'none';
        }
    } else if (game.status === 'flipping') {
        document.getElementById('coinflip-bet-section').style.display = 'none';
        document.getElementById('coinflip-waiting-match').style.display = 'none';
        document.getElementById('coinflip-matching').style.display = 'none';
        document.getElementById('coinflip-waiting-to-match').style.display = 'none';
        document.getElementById('coinflip-flipping').style.display = '';
        
        // Start the flip animation if not already done
        const coin = document.getElementById('the-coin');
        if (!coin.classList.contains('flipping') && !coin.classList.contains('win') && !coin.classList.contains('lose')) {
            coin.classList.add('flipping');
            // After animation, show result
            setTimeout(() => showCoinFlipResult(db, game), 1500);
        }
    } else if (game.status === 'done') {
        await showCoinFlipResult(db, game);
    }
}

async function setCoinFlipBet() {
    if (!requireToken()) return;
    
    const amount = parseInt(document.getElementById('coinflip-bet-amount').value);
    if (!amount || amount < 1) {
        showToast('Enter a valid bet amount', 'error');
        return;
    }
    
    const db = await reloadDB();
    const game = db.coinflip?.active[currentUser];
    if (!game || game.status !== 'setting_bet' || game.player1 !== currentUser) {
        showToast('Not your turn to set the bet', 'error');
        return;
    }
    
    const user = db.users[currentUser];
    if (!user || user.balance < amount) {
        showToast('Insufficient balance!', 'error');
        return;
    }
    
    if (amount > 10000) {
        showToast('Max bet is 10,000 credits', 'error');
        return;
    }
    
    game.bet = amount;
    game.status = 'waiting_match';
    await saveDB(db);
    showToast(`Bet set to ${formatNumber(amount)} credits!`, 'success');
    await checkCoinFlipQueue();
}

async function matchCoinFlipBet() {
    if (!requireToken()) return;
    
    const db = await reloadDB();
    const game = db.coinflip?.active[currentUser];
    if (!game || game.status !== 'waiting_match' || game.player2 !== currentUser) {
        showToast('Not your turn', 'error');
        return;
    }
    
    const user = db.users[currentUser];
    if (!user || user.balance < game.bet) {
        showToast('Insufficient balance to match!', 'error');
        return;
    }
    
    game.status = 'flipping';
    await saveDB(db);
    showToast('Matched! Flipping the coin...', 'success');
    await checkCoinFlipQueue();
}

async function showCoinFlipResult(db, game) {
    if (game.status !== 'done') {
        // Process the flip result
        const result = game.coinSide; // 'heads' or 'tails'
        const isP1Heads = true; // P1 is always heads
        const winner = result === 'heads' ? game.player1 : game.player2;
        const loser = result === 'heads' ? game.player2 : game.player1;
        const isWinner = winner === currentUser;
        
        // Payout: winner gets both bets, so net gain = opponent's bet
        const winnerUser = db.users[winner];
        const loserUser = db.users[loser];
        
        if (winnerUser) winnerUser.balance = (winnerUser.balance || 0) + game.bet;
        if (loserUser) loserUser.balance = Math.max(0, (loserUser.balance || 0) - game.bet);
        
        // Record transaction
        if (!db.transactions) db.transactions = [];
        db.transactions.push({
            type: 'coinflip',
            from: loser,
            to: winner,
            amount: game.bet,
            timestamp: Date.now(),
            note: `Coin flip: ${result}! ${winner} wins!`
        });
        
        game.status = 'done';
        game.result = result;
        game.winner = winner;
        await saveDB(db);
        
        // Reload user data
        const freshDb = await reloadDB();
        userData = freshDb.users[currentUser];
    }
    
    // Show the result
    const coin = document.getElementById('the-coin');
    const isWinner = game.winner === currentUser;
    
    coin.classList.remove('flipping');
    coin.classList.add(isWinner ? 'win' : 'lose');
    
    document.getElementById('coinflip-flipping').style.display = 'none';
    document.getElementById('coinflip-result').style.display = '';
    
    document.getElementById('cf-result-icon').textContent = isWinner ? '🏆' : '💔';
    document.getElementById('cf-result-text').textContent = isWinner ? 'You Won!' : 'You Lost!';
    document.getElementById('cf-result-text').style.color = isWinner ? 'var(--success)' : 'var(--danger)';
    document.getElementById('cf-result-amount').textContent = isWinner 
        ? `+${formatNumber(game.bet)} credits` 
        : `-${formatNumber(game.bet)} credits`;
    document.getElementById('cf-result-amount').style.color = isWinner ? 'var(--success)' : 'var(--danger)';
    
    updateUI();
}

// ==================== UTILITIES ====================
function formatNumber(num) {
    return num.toLocaleString();
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function showMessage(message, type) {
    // Find the visible message element
    const msgEl = document.getElementById('token-message') || document.getElementById('login-message');
    if (msgEl) {
        msgEl.textContent = message;
        msgEl.className = `message ${type}`;
    }
}

function clearMessage() {
    const msgEl = document.getElementById('token-message') || document.getElementById('login-message');
    if (msgEl) msgEl.className = 'message';
}

function validatePassword(password) {
    const errors = [];
    if (password.length < 8) errors.push('length');
    if (!/[A-Z]/.test(password)) errors.push('upper');
    if (!/[a-z]/.test(password)) errors.push('lower');
    if (!/[0-9]/.test(password)) errors.push('number');
    if (!/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) errors.push('special');
    return errors;
}

function validatePasswordInput() {
    const password = document.getElementById('reg-password').value;
    
    document.getElementById('req-length').className = password.length >= 8 ? 'valid' : '';
    document.getElementById('req-upper').className = /[A-Z]/.test(password) ? 'valid' : '';
    document.getElementById('req-lower').className = /[a-z]/.test(password) ? 'valid' : '';
    document.getElementById('req-number').className = /[0-9]/.test(password) ? 'valid' : '';
    document.getElementById('req-special').className = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password) ? 'valid' : '';
}

// ==================== PWA SERVICE WORKER ====================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker registered:', reg.scope))
            .catch(err => console.log('Service Worker failed:', err));
    });
}
