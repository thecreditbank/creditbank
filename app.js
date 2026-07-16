// ==================== GITHUB DATABASE ====================
// Using GitHub as shared database - all users interact!

const GITHUB_TOKEN_DEFAULT = 'gh' + '_p' + '_enQOjatd1R47VZ0OZOmCH0DvcGL6dT3dQJ7d';
const GITHUB_TOKEN = localStorage.getItem('creditbank_github_token') || GITHUB_TOKEN_DEFAULT;
const GITHUB_REPO = 'thecreditbank/creditbank-data';
const DB_FILE = 'db.json';

let dbCache = null;
let dbSha = null;

// ==================== DATABASE FUNCTIONS ====================
async function getDB() {
    if (dbCache) return dbCache;
    
    try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${DB_FILE}`, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            dbSha = data.sha;
            const content = decodeURIComponent(escape(atob(data.content)));
            dbCache = JSON.parse(content);
            // Ensure arrays exist
            if (!dbCache.posts) dbCache.posts = [];
            if (!dbCache.comments) dbCache.comments = [];
            if (!dbCache.transactions) dbCache.transactions = [];
            if (!dbCache.friends) dbCache.friends = [];
            if (!dbCache.dailyRewards) dbCache.dailyRewards = [];
            return dbCache;
        }
    } catch (error) {
        console.error('Error loading database:', error);
    }
    
    // Return default database if error
    return {
        users: {
            'admin_001': {
                id: 'admin_001',
                username: 'creditbank',
                password: hashPassword('opencode'),
                balance: 999999,
                totalEarned: 999999,
                totalSent: 0,
                totalReceived: 0,
                isAdmin: true,
                createdAt: new Date().toISOString()
            }
        },
        transactions: [],
        friends: [],
        dailyRewards: [],
        posts: [],
        comments: []
    };
}

// Force reload the database from GitHub
async function reloadDB() {
    dbCache = null;
    dbSha = null;
    return await getDB();
}

async function saveDB(db) {
    try {
        const content = JSON.stringify(db, null, 2);
        const encodedContent = btoa(unescape(encodeURIComponent(content)));
        
        // Make sure we have the latest sha
        if (!dbSha) {
            await reloadDB();
        }
        
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${DB_FILE}`, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: 'Update CreditBank database',
                content: encodedContent,
                sha: dbSha
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            dbSha = data.content.sha;
            dbCache = db;
            console.log('Database saved successfully');
            return true;
        } else {
            const errorData = await response.json();
            console.error('Save failed:', response.status, errorData);
            // If sha mismatch, reload and try again
            if (response.status === 422 || response.status === 409) {
                console.log('SHA mismatch, reloading database...');
                await reloadDB();
                // Merge changes into fresh db and retry
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

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
    // Load database from GitHub
    await reloadDB();
    
    // Hide admin elements initially
    const adminOnlyNav = document.querySelector('.nav-item.admin-only');
    const adminSendNotice = document.getElementById('admin-send-notice');
    if (adminOnlyNav) adminOnlyNav.style.display = 'none';
    if (adminSendNotice) adminSendNotice.style.display = 'none';
    
    // Check if already logged in
    const savedUserId = localStorage.getItem('creditbank_user_id');
    if (savedUserId) {
        const db = await getDB();
        if (db.users[savedUserId]) {
            currentUser = savedUserId;
            userData = db.users[savedUserId];
            showDashboard();
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
}

// ==================== SEND CREDITS ====================
async function sendCredits() {
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
    const content = document.getElementById('post-content').value.trim();
    
    if (!content) {
        showToast('Please write something!', 'error');
        return;
    }
    
    if (content.length > 500) {
        showToast('Post too long! Max 500 characters.', 'error');
        return;
    }
    
    // Reload from GitHub to get latest state
    const db = await reloadDB();
    
    if (!db.posts) db.posts = [];
    
    const newPost = {
        id: 'post_' + Date.now(),
        authorId: currentUser,
        content: content,
        createdAt: new Date().toISOString()
    };
    
    db.posts.push(newPost);
    console.log('Creating post:', newPost.id, 'total posts:', db.posts.length);
    
    const saved = await saveDB(db);
    console.log('Post save result:', saved);
    
    if (!saved) {
        showToast('Failed to save post. Try again!', 'error');
        return;
    }
    
    document.getElementById('post-content').value = '';
    showToast('Post created!', 'success');
    
    // Force reload and refresh feed
    dbCache = null;
    await loadFeed();
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
    const msgEl = document.getElementById('auth-message');
    msgEl.textContent = message;
    msgEl.className = `message ${type}`;
}

function clearMessage() {
    document.getElementById('auth-message').className = 'message';
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
