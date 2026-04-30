const puppeteer = require('puppeteer');
const fs = require('fs');
const ftp = require("basic-ftp");

(async () => {
    console.log("🎬 Démarrage du script...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("🚀 Connexion au portail...");
        await page.goto('https://planning.univ-lemans.fr/direct/myplanning.jsp', { waitUntil: 'networkidle2' });

        // --- ÉTAPE 1 : AUTHENTIFICATION ---
        await page.waitForSelector('#username', { visible: true });
        await page.type('#username', process.env.ADE_USER); 
        await page.type('#password', process.env.ADE_PASS);
        await Promise.all([page.click('#submitBtn'), page.waitForNavigation({ waitUntil: 'networkidle0' })]);

        // --- ÉTAPE 2 : NAVIGATION FACULTATIVE ---
        try {
            const continuerBtn = await page.waitForSelector('xpath///span[contains(translate(text(), "CONTINUE", "continue"), "continu")]', { visible: true, timeout: 5000 });
            await continuerBtn.click();
            await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
        } catch (e) { console.log("ℹ️ Pas de bouton continuer."); }

        // --- ÉTAPE 3 : NAVIGATION ARBORESCENCE (CORRIGÉE) ---
        console.log("📂 Recherche de l'arborescence...");
        // On attend que l'un des éléments de l'arbre soit présent
        await page.waitForSelector('.x-tree3-node', { timeout: 30000 });

        const chemin = ["Etudiants", "IUT LAVAL", "Dpt MMI", "BUT MMI1", "TD11", "11B"];
        
        for (const texte of chemin) {
            console.log(`📍 Recherche de : ${texte}`);
            // Sélecteur plus robuste : cherche un span qui contient exactement le texte
            const xpath = `xpath///span[filter(text(), "${texte}")] | //span[text()="${texte}"]`;
            
            const element = await page.waitForSelector(`xpath///span[contains(text(), "${texte}")]`, { visible: true, timeout: 15000 });
            
            // On cherche l'icône de déploiement (le petit +) juste à côté
            const icone = await page.$(`xpath///span[contains(text(), "${texte}")]/preceding-sibling::img[contains(@class, "x-tree3-node-joint")]`);
            
            if (icone && texte !== "11B") {
                await icone.click();
            } else {
                await element.click({ clickCount: 2 }); // Double clic si pas d'icône
            }
            await new Promise(r => setTimeout(r, 2500)); // Pause pour laisser l'arbre se déplier
        }

        // --- ÉTAPE 4 : EXTRACTION ---
        console.log("📊 Extraction des cours...");
        await new Promise(r => setTimeout(r, 5000)); 
        const planningData = await page.evaluate(() => {
            const joursSemaine = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
            return Array.from(document.querySelectorAll('.eventText'))
                .filter(b => b.innerText.trim().length > 1)
                .map(bloc => {
                    const container = bloc.parentElement.parentElement;
                    const left = parseInt(container.style.left) || 0;
                    const indexJour = Math.round(left / 245);
                    const lignes = bloc.innerText.split('\n').map(s => s.trim()).filter(s => s !== "");
                    return {
                        jour: joursSemaine[indexJour] || "Inconnu",
                        matiere: lignes[0],
                        salle: lignes.find(l => l.includes('-MMI') || l.includes('Amphi')) || "N/C",
                        horaire: (lignes.find(l => l.includes('h')) || "").match(/\d{2}h\d{2}\s*-\s*\d{2}h\d{2}/)?.[0] || "N/C",
                        _position: { x: left, y: parseInt(container.style.top) || 0 }
                    };
                });
        });

        // --- ÉTAPE 5 : ENVOI ---
        fs.writeFileSync('planning.json', JSON.stringify(planningData, null, 2));
        const client = new ftp.Client();
        await client.access({ host: process.env.FTP_HOST, user: process.env.FTP_USER, password: process.env.FTP_PASS, secure: false });
        await client.uploadFrom("planning.json", "public_html/planning.json");
        console.log("🚀 TERMINÉ : PLANNING EN LIGNE !");
        client.close();

    } catch (error) {
        console.error("❌ ERREUR:", error.message);
    } finally {
        await browser.close();
    }
})();