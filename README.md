# TravelCanvas - React + Vite Enhanced Development Environment

A modern AI-powered travel planning and optimization platform with React + Vite frontend and complete development infrastructure.

## 🚀 Features

- 🎨 **AI-Powered Planning**: Intelligent travel route optimization using Google OR-Tools
- ⚡ **React + Vite Frontend**: Lightning-fast development with Hot Module Replacement
- 🔧 **Complete Stack**: FastAPI backend with React + Vite TypeScript frontend
- 🗄️ **Full Database**: PostgreSQL + Redis with optimization
- 🔄 **Real-time Updates**: Live optimization and dynamic route adjustments
- 📊 **Data Analytics**: Travel cost analysis and optimization scoring
- 🔒 **Enterprise Security**: UFW, fail2ban, SSL certificates
- 🐳 **Full Containerization**: Docker + Docker Compose
- 📦 **Package Managers**: npm, yarn, pnpm, Poetry, pipenv
- 🛠️ **Development Tools**: VS Code, comprehensive testing, CI/CD ready
- 📱 **Native App Ready**: Shared components for future React Native development

## 🏗️ Architecture

### Frontend Stack (React + Vite Enhanced)
- **React 18**: Latest React with concurrent features
- **Vite**: Next-generation frontend tooling with HMR
- **TypeScript**: Full type safety and modern development
- **Tailwind CSS**: Utility-first CSS framework
- **React Router**: Client-side routing
- **Tanstack Query**: Server state management

### Backend Stack
- **FastAPI**: Modern, fast web framework for building APIs
- **SQLAlchemy**: SQL toolkit and ORM with PostgreSQL
- **Redis**: In-memory data structure store for caching
- **Google OR-Tools**: Optimization suite for solving complex problems
- **Celery**: Distributed task queue for background processing

### Infrastructure
- **Docker**: Full containerization with development and production configs
- **Nginx**: High-performance web server and reverse proxy
- **PostgreSQL**: Advanced relational database with performance optimization
- **UFW + fail2ban**: Security and intrusion prevention
- **Certbot**: SSL certificate management

### Development Tools
- **Poetry & pipenv**: Python package management
- **yarn & pnpm**: Node.js package managers
- **VS Code**: IDE with extensions and configurations
- **Testing**: Vitest, Jest, pytest, comprehensive test suites
- **Code Quality**: Black, isort, mypy, ESLint, Prettier

## 🚀 Quick Start

### 1. Environment Setup
```bash
# Activate Python virtual environment
tc-activate

# Navigate to project
tc-cd

# Check system status
tc-status
```

### 2. Backend Development
```bash
# Start backend server
tc-backend

# Alternative: Manual start
cd backend
source ~/travelcanvas_venv/bin/activate
uvicorn app.main:app --reload
```

### 3. Frontend Development (React + Vite)
```bash
# Start frontend server (new terminal)
tc-frontend

# Alternative: Manual start
cd frontend
npm run dev
```

### 4. Docker Environment
```bash
# Start full Docker environment
tc-docker

# Alternative: Manual start
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

## 🌐 Access URLs

- **Frontend (React + Vite)**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs
- **Redoc**: http://localhost:8000/redoc

## 🛠️ Development Commands

### Environment Management
- `tc-help` - Show all available commands
- `tc-dev` - Start development environment
- `tc-status` - Check system status
- `tc-activate` - Activate Python virtual environment
- `tc-cd` - Navigate to project directory

### Application Servers
- `tc-backend` - Start FastAPI backend server
- `tc-frontend` - Start React + Vite frontend server
- `tc-docker` - Start Docker Compose environment

### Database Management
- `tc-db-reset` - Reset and recreate databases
- `tc-backup` - Create database backup

### Testing & Quality
- `tc-test` - Run all test suites
- Backend: pytest, mypy, black, isort, flake8
- Frontend: Vitest, ESLint, TypeScript checks

### Docker Operations
- `tc-up` - Start Docker containers
- `tc-down` - Stop Docker containers
- `tc-logs` - View Docker logs
- `tc-restart` - Restart Docker containers

## 📁 Project Structure

```
travelcanvas/
├── backend/                 # FastAPI application
│   ├── app/
│   │   ├── api/v1/         # API routes
│   │   ├── core/           # Core configurations
│   │   ├── models/         # Database models
│   │   └── main.py         # Application entry point
│   ├── tests/              # Backend tests
│   ├── requirements.txt    # Python dependencies
│   └── pyproject.toml      # Poetry configuration
├── frontend/               # React + Vite application
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── pages/          # Page components
│   │   ├── hooks/          # Custom hooks
│   │   ├── services/       # API services
│   │   ├── store/          # State management
│   │   ├── types/          # TypeScript types
│   │   └── main.tsx        # Application entry point
│   ├── package.json        # Node.js dependencies
│   ├── vite.config.ts      # Vite configuration
│   └── tsconfig.json       # TypeScript configuration
├── shared/                 # Shared components (for future native apps)
│   ├── components/         # Reusable components
│   ├── utils/              # Utility functions
│   ├── types/              # Shared TypeScript types
│   └── services/           # API service definitions
├── mobile/                 # Native app preparation
│   ├── react-native/       # React Native setup
│   └── expo/               # Expo setup
├── database/               # Database scripts and migrations
├── docker/                 # Docker configurations
├── scripts/                # Development and deployment scripts
├── docs/                   # Documentation
├── tests/                  # Integration and E2E tests
└── .env.local             # Environment variables
```

## 🧪 Testing

### Backend Testing
```bash
# Full test suite
cd backend
python -m pytest tests/ -v --cov=app --cov-report=html

# Code quality checks
mypy app/
black --check app/
isort --check-only app/
flake8 app/
```

### Frontend Testing (React + Vite)
```bash
# Unit tests
cd frontend
npm run test

# Linting and type checking
npm run lint
npm run type-check

# Build test
npm run build
```

### Integration Testing
```bash
# All tests
tc-test
```

## 🚀 Deployment

### Docker Production
```bash
# Production build
docker compose -f docker-compose.yml up -d

# With SSL (configure domain first)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Manual Deployment
```bash
# Backend
cd backend
gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker

# Frontend (React + Vite)
cd frontend
npm run build
npm run preview
```

## 📱 Native App Development

The project structure is prepared for future native app development:

### React Native Setup
```bash
# Navigate to mobile directory
cd mobile/react-native

# Initialize React Native project
npx react-native init TravelCanvasNative

# Copy shared components
cp -r ../../shared/* ./src/shared/
```

### Expo Setup
```bash
# Navigate to mobile directory
cd mobile/expo

# Initialize Expo project
npx create-expo-app TravelCanvasExpo

# Copy shared components
cp -r ../../shared/* ./src/shared/
```

## 🔧 Configuration

### Environment Variables
Copy `.env.example` to `.env.local` and configure:

```bash
cp .env.example .env.local
nano .env.local
```

Key configurations:
- Database credentials (auto-generated)
- API keys (Google Maps, OpenAI, etc.)
- Security settings
- Feature flags

### Package Managers
All major package managers are supported:

**Python:**
- Poetry (recommended for dependency management)
- pipenv (alternative dependency management)
- pip (basic package installation)

**Node.js:**
- npm (default package manager)
- yarn (fast, reliable package manager)
- pnpm (efficient disk space usage)

## 🏗️ Complete Technology Stack

### 🎨 Frontend (React + Vite Enhanced):
- Next-generation build tooling with Vite
- React 18 with concurrent features
- TypeScript 5 for type safety
- Tailwind CSS for styling
- Hot Module Replacement for instant updates
- Tree-shaking and code splitting
- Native app development ready

### ⚙️ Backend:
- FastAPI + Uvicorn + SQLAlchemy 2.0
- PostgreSQL（パフォーマンス最適化済み）
- Redis（メモリ最適化・キャッシュ）
- Celery（バックグラウンドタスク）
- Google OR-Tools（最適化エンジン）

### 🐳 Infrastructure・DevOps:
- Docker + Docker Compose（開発・本番対応）
- Nginx（リバースプロキシ・SSL対応）
- UFW + fail2ban（セキュリティ）
- Certbot（SSL証明書自動管理）

### 🛠️ Development Tools:
- VS Code（設定済み拡張機能）
- Poetry + pipenv（Python依存関係管理）
- yarn + pnpm（Node.js パッケージ管理）
- Git（強化設定・エイリアス）
- 完全テストスイート（Vitest + pytest）

## 🎯 Next Steps

1. 🔄 **Shell Configuration Reload**:
   ```bash
   source ~/.bashrc
   # or open new terminal
   ```

2. 🚀 **Start Development Environment**:
   ```bash
   tc-dev
   ```

3. 📁 **Navigate to Project**:
   ```bash
   tc-cd
   ```

4. 🐍 **Activate Python Environment**:
   ```bash
   tc-activate
   ```

5. ⚙️ **Edit Environment Configuration**:
   ```bash
   nano ~/travelcanvas/.env.local
   ```

6. 🔍 **Check System Status**:
   ```bash
   tc-status
   ```

7. 🖥️ **Start Servers**:
   ```bash
   tc-backend    # Terminal 1
   tc-frontend   # Terminal 2 (React + Vite)
   ```

## 📄 License

MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

- React and Vite communities for modern frontend tooling
- Google OR-Tools for optimization algorithms
- FastAPI community for excellent backend framework
- Docker and containerization ecosystem
- Open source contributors

---

**TravelCanvas** - React + Vite Enhanced Development Environment
*Complete AI-powered travel planning platform with lightning-fast frontend development*
