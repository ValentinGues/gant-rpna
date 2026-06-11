import { columns } from './data.js';

class KanbanBoard {
    constructor() {
        this.tasks = [];
        this.columns = columns;
        this.boardContainer = document.getElementById('kanban-board');
        this.sortables = [];
        
        // Auth State
        this.currentUser = sessionStorage.getItem('rpna_user') || null;
        this.showAll = false;

        // Initialize Socket.io connection
        this.socket = io();

        this.setupSocketListeners();
        this.init();
    }

    setupSocketListeners() {
        this.socket.on('init_tasks', (serverTasks) => {
            this.tasks = serverTasks;
            this.renderBoard();
        });

        this.socket.on('tasks_updated', (serverTasks) => {
            this.tasks = serverTasks;
            this.renderBoard();
        });
    }

    saveTasks() {
        this.socket.emit('update_tasks', this.tasks);
    }

    init() {
        this.setupAuth();
        this.setupModal();
        this.setupSearch();
        this.setupToggle();
        this.setupNavigation();
    }

    setupNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        const views = document.querySelectorAll('.view-section');

        navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                
                // Remove active class from all
                navItems.forEach(nav => nav.classList.remove('active'));
                views.forEach(view => {
                    view.style.display = 'none';
                    view.classList.remove('active');
                });
                
                // Add active to clicked item
                item.classList.add('active');
                
                // Show corresponding view
                const targetId = item.dataset.target;
                if (targetId) {
                    const targetView = document.getElementById(targetId);
                    if (targetView) {
                        targetView.style.display = targetId === 'view-board' ? 'flex' : 'block';
                        targetView.classList.add('active');
                    }
                }
            });
        });
    }

    setupAuth() {
        const loginOverlay = document.getElementById('login-overlay');
        const mainApp = document.getElementById('main-app');
        const userBtns = document.querySelectorAll('.user-btn');
        const logoutBtn = document.getElementById('logout-btn');
        const currentUserAvatar = document.getElementById('current-user-avatar');

        const updateAuthState = () => {
            if (this.currentUser) {
                loginOverlay.classList.add('hidden');
                mainApp.style.display = 'flex';
                currentUserAvatar.textContent = this.currentUser.charAt(0).toUpperCase();
                
                // Get the avatar color from the login screen
                const userBtn = Array.from(userBtns).find(btn => btn.dataset.name === this.currentUser);
                if (userBtn) {
                    const bgColor = userBtn.querySelector('.avatar').style.background;
                    if(bgColor) {
                        currentUserAvatar.style.background = bgColor;
                    } else {
                        currentUserAvatar.style.background = 'linear-gradient(135deg, var(--accent), #f43f5e)'; // default
                    }
                }
                
                this.renderBoard();
            } else {
                loginOverlay.classList.remove('hidden');
                mainApp.style.display = 'none';
            }
        };

        userBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentUser = btn.dataset.name;
                sessionStorage.setItem('rpna_user', this.currentUser);
                updateAuthState();
            });
        });

        logoutBtn.addEventListener('click', () => {
            this.currentUser = null;
            sessionStorage.removeItem('rpna_user');
            updateAuthState();
        });

        // Init on load
        updateAuthState();
    }

    setupToggle() {
        const toggle = document.getElementById('show-all-toggle');
        toggle.addEventListener('change', (e) => {
            this.showAll = e.target.checked;
            this.renderBoard();
        });
    }

    renderBoard() {
        if (!this.currentUser) return; // Don't render if not logged in

        this.boardContainer.innerHTML = '';
        this.sortables.forEach(s => s.destroy());
        this.sortables = [];

        this.columns.forEach(column => {
            // Filter tasks for this column
            let columnTasks = this.tasks.filter(t => t.status === column.id).filter(t => {
                if (this.showAll) return true;
                if (!t.assignee) return false;
                // e.g. "Valentin, Jeremy" -> checks if contains "Valentin"
                return t.assignee.includes(this.currentUser);
            });
            
            // Sort 'todo' column so doable tasks appear first
            if (column.id === 'todo') {
                columnTasks.sort((a, b) => {
                    const doableA = this.isTaskDoable(a) ? 1 : 0;
                    const doableB = this.isTaskDoable(b) ? 1 : 0;
                    return doableB - doableA;
                });
            }
            
            const colEl = document.createElement('div');
            colEl.className = 'kanban-column';
            colEl.innerHTML = `
                <div class="column-header">
                    <div class="column-title-container">
                        <span>${column.title}</span>
                        <span class="task-count">${columnTasks.length}</span>
                    </div>
                </div>
                <div class="task-list" data-status="${column.id}"></div>
            `;

            const taskListEl = colEl.querySelector('.task-list');
            
            columnTasks.forEach(task => {
                taskListEl.appendChild(this.createTaskElement(task));
            });

            this.boardContainer.appendChild(colEl);

            // Initialize SortableJS for this column
            const sortable = new Sortable(taskListEl, {
                group: 'kanban',
                animation: 150,
                ghostClass: 'sortable-ghost',
                
                // Prevent moving if dependencies are not met
                onMove: (evt) => {
                    const taskId = evt.dragged.dataset.id;
                    const newStatus = evt.to.dataset.status;
                    const oldStatus = evt.from.dataset.status;
                    
                    // Moving out of 'todo' to something else (in-progress, review, done)
                    if (oldStatus === 'todo' && newStatus !== 'todo') {
                        const task = this.tasks.find(t => t.id === taskId);
                        if (task && task.dependencies && task.dependencies.length > 0) {
                            // Check if all dependencies are 'done'
                            const unresolved = task.dependencies.filter(depId => {
                                const parent = this.tasks.find(t => t.id === depId);
                                return parent && parent.status !== 'done';
                            });

                            if (unresolved.length > 0) {
                                // Highlight the fact that it's blocked (Sortable allows preventing move by returning false)
                                return false;
                            }
                        }
                    }
                    return true; // Allow move
                },

                onEnd: (evt) => {
                    const taskId = evt.item.dataset.id;
                    const newStatus = evt.to.dataset.status;
                    const oldStatus = evt.from.dataset.status;

                    if(newStatus === oldStatus) return; // No change
                    
                    const taskIndex = this.tasks.findIndex(t => t.id === taskId);
                    if (taskIndex !== -1) {
                        this.tasks[taskIndex].status = newStatus;
                        this.saveTasks();
                        
                        // Small timeout to allow DOM to settle before re-rendering completely
                        setTimeout(() => this.renderBoard(), 50);
                    }
                }
            });
            this.sortables.push(sortable);
        });
        
        // Re-apply search filter if there's any active text
        const searchInput = document.querySelector('.search-bar input');
        if (searchInput && searchInput.value) {
            searchInput.dispatchEvent(new Event('input'));
        }
    }

    createTaskElement(task) {
        const el = document.createElement('div');
        el.className = 'task-card';
        el.dataset.id = task.id;
        
        const avatarLetter = task.assignee ? task.assignee.charAt(0).toUpperCase() : '?';

        // Check dependencies to render the badge
        let depsHtml = '';
        if (task.dependencies && task.dependencies.length > 0) {
            let unresolvedCount = 0;
            const depsList = task.dependencies.map(depId => {
                const parent = this.tasks.find(t => t.id === depId);
                if (!parent) return '';
                const isDone = parent.status === 'done';
                if (!isDone) unresolvedCount++;
                return `
                    <div class="dep-item">
                        <span class="dep-status ${isDone ? 'dep-done' : 'dep-pending'}"></span>
                        <span>${parent.title.substring(0, 25)}...</span>
                    </div>
                `;
            }).join('');

            const titleColor = unresolvedCount > 0 ? 'var(--priority-high)' : 'var(--priority-low)';
            depsHtml = `
                <div class="task-dependencies">
                    <strong style="color: ${titleColor};">Prérequis (${task.dependencies.length - unresolvedCount}/${task.dependencies.length} terminés)</strong>
                    ${depsList}
                </div>
            `;
        }

        el.innerHTML = `
            <button class="delete-btn" title="Supprimer" data-id="${task.id}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
            ${task.category ? `<span class="task-category">${task.category}</span>` : ''}
            <h4 class="task-title">${task.title}</h4>
            ${task.description ? `<p class="task-desc">${task.description}</p>` : ''}
            ${depsHtml}
            <div class="task-footer">
                <span class="priority-badge priority-${task.priority}">
                    ${this.getPriorityLabel(task.priority)}
                </span>
                ${task.assignee ? `
                <div class="task-assignee">
                    <div class="assignee-avatar">${avatarLetter}</div>
                    <span>${task.assignee}</span>
                </div>
                ` : ''}
            </div>
        `;

        el.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if(confirm("Êtes-vous sûr de vouloir supprimer cette tâche ?")) {
                this.tasks = this.tasks.filter(t => t.id !== task.id);
                this.saveTasks();
                this.renderBoard();
            }
        });

        // Add a visual shake if clicking a blocked task
        el.addEventListener('mousedown', () => {
            if (task.status === 'todo' && task.dependencies && task.dependencies.some(d => {
                const parent = this.tasks.find(t => t.id === d);
                return parent && parent.status !== 'done';
            })) {
                el.style.border = '1px solid var(--priority-high)';
                setTimeout(() => el.style.border = '1px solid var(--border-color)', 500);
            }
        });

        return el;
    }

    isTaskDoable(task) {
        if (!task.dependencies || task.dependencies.length === 0) return true;
        return task.dependencies.every(depId => {
            const parent = this.tasks.find(t => t.id === depId);
            return parent && parent.status === 'done';
        });
    }

    getPriorityLabel(priority) {
        switch(priority) {
            case 'high': return 'Haute';
            case 'medium': return 'Moyenne';
            case 'low': return 'Basse';
            default: return 'Normal';
        }
    }

    setupModal() {
        const modal = document.getElementById('task-modal');
        const addBtn = document.getElementById('add-task-btn');
        const closeBtn = document.getElementById('close-modal');
        const cancelBtn = document.getElementById('cancel-task-btn');
        const form = document.getElementById('task-form');

        const openModal = () => {
            form.reset();
            document.getElementById('task-id').value = '';
            document.getElementById('modal-title').textContent = 'Nouvelle Tâche';
            
            // Auto-fill assignee with current user
            if (this.currentUser) {
                document.getElementById('task-assignee').value = this.currentUser;
            }

            modal.classList.remove('hidden');
        };

        const closeModal = () => modal.classList.add('hidden');

        addBtn.addEventListener('click', openModal);
        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', (e) => { e.preventDefault(); closeModal(); });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const newTask = {
                id: 'task-' + Date.now(),
                title: document.getElementById('task-title').value,
                description: document.getElementById('task-desc').value,
                status: document.getElementById('task-status').value,
                priority: document.getElementById('task-priority').value,
                category: document.getElementById('task-category').value,
                assignee: document.getElementById('task-assignee').value,
                dependencies: [] // Simplification: new tasks have no deps by default via UI
            };

            this.tasks.push(newTask);
            this.saveTasks();
            this.renderBoard();
            closeModal();
        });
    }

    setupSearch() {
        const searchInput = document.querySelector('.search-bar input');
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const allCards = document.querySelectorAll('.task-card');
            
            allCards.forEach(card => {
                const title = card.querySelector('.task-title').textContent.toLowerCase();
                const desc = card.querySelector('.task-desc')?.textContent.toLowerCase() || '';
                const category = card.querySelector('.task-category')?.textContent.toLowerCase() || '';
                
                if (title.includes(term) || desc.includes(term) || category.includes(term)) {
                    card.style.display = 'block';
                } else {
                    card.style.display = 'none';
                }
            });
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new KanbanBoard();
});
