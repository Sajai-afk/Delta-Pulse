# Delta-Pulse

## Repository Structure

### 1. Datasets (`public/data/`)

All project datasets are stored and pushed inside the `public/data/` folder.

- `shorelines/` – Historical coastline datasets (2015–2025).
- `subsidence.geojson` – Subsidence-related dataset.

### 2. Source Code (`src/`)

The main website source code is available inside the `src/` folder.

- `App.jsx` – Main application component.
- `App.css` – Application styling.
- `main.jsx` – Application entry point.
- `assets/` – Website assets.

### 3. Scripts (`scripts/`)

Contains supporting Python scripts used in the project.

## Running the Project Locally
### Step 3: Install Dependencies

Run the following command:

```bash
npm install
```

This installs all the packages and dependencies required by the project.

**Note:** This step is required during the initial setup and whenever project dependencies change.

### Step 4: Run the Website Locally

Start the development server:

```bash
npm run dev
```

After executing the command, the terminal will display a local development URL.

Usually:

```text
http://localhost:5173/
```

Open the displayed URL in your browser to access Delta-Pulse.

### Step 5: Build the Project

To generate the production version of the website, execute:

```bash
npm run build
```

This generates the production-ready files inside the `dist/` directory.

### Step 6: Preview the Production Build (Optional)

To preview the generated production version locally:

```bash
npm run preview
```

---

## Important Information

- `npm install` installs the required dependencies.
- `npm run dev` starts the local development server.
- `npm run build` generates the production build.
- `npm run preview` previews the production build.
- `node_modules/` is generated automatically and is not included in GitHub.
- `dist/` is generated during the build process and is not included in GitHub.
- All project datasets are maintained inside `public/data/`.
- The application source code is maintained inside `src/`.
---

Clone the repository:

```bash
git clone https://github.com/Sajai-afk/Delta-Pulse.git
