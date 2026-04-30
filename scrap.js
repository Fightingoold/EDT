const puppeteer = require('puppeteer');
const fs = require('fs');
const ftp = require("basic-ftp");

(async () => {
    console.log("🎬 Démarrage du script (Mode Debug)...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    const client = new ftp.Client();

    try {
        console.log("🚀 Connexion au portail...");
        await page.goto('https://planning.univ-lemans.fr/direct/myplanning.jsp', { waitUntil: 'networkidle2' });

        // --- ÉTAPE 1 : AUTHENTIFICATION ---
        await page.waitForSelector('#username', { visible: true });
        await page.type('#username', process.env.ADE_USER); 
        await page.type('#password', process.env.ADE_PASS);
        await Promise.all([
            page.click('#submitBtn'),
            page.waitForNavigation({ waitUntil: 'networkidle0' })
        ]);

        // --- ÉTAPE 2 : NAVIGATION FACULTATIVE ---
        try {
            const continuerBtn = await page.waitForSelector('xpath///span[contains(text(), "Continu")]', { visible: true, timeout: 5000 });
            await continuerBtn.click();
            await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
        } catch (e) { console.log("ℹ️ Pas de bouton continuer."); }

        // --- ÉTAPE 3 : NAVIGATION ARBORESCENCE ---
        console.log("📂 Recherche de l'arborescence...");
        // On attend un peu que l'interface se stabilise
        await new Promise(r => setTimeout(r, 5000)); 

        const chemin = ["Etudiants", "IUT LAVAL", "Dpt MMI", "BUT MMI1", "TD11", "11B"];
        
        for (const texte of chemin) {
            console.log(`📍 Recherche de : ${texte}`);
            const element = await page.waitForSelector(`xpath///span[contains(text(), "${texte}")]`, { visible: true, timeout: 15000 });
            
            const icone = await page.$(`xpath///span[contains(text(), "${texte}")]/preceding-sibling::img[contains(@class, "x-tree3-node-joint")]`);
            
            if (icone && texte !== "11B") {
                await icone.click();
            } else {
                await element.click({ clickCount: 2 });
            }
            await new Promise(r => setTimeout(r, 3000)); 
        }

        // --- ÉTAPE 4 : EXTRACTION ET ENVOI ---
        const planningData = await page.evaluate(() => {
            const jours = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
            return Array.from(document.querySelectorAll('.eventText'))
                .filter(b => b.innerText.trim().length > 1)
                .map(bloc => {
                    const container = bloc.parentElement.parentElement;
                    const left = parseInt(container.style.left) || 0;
                    return {
                        jour: jours[Math.round(left / 245)] || "Inconnu",
                        matiere: bloc.innerText.split('\n')[0],
                        _position: { x: left, y: parseInt(container.style.top) || 0 }
                    };
                });
        });

        fs.writeFileSync('planning.json', JSON.stringify(planningData, null, 2));
        await client.access({ host: process.env.FTP_HOST, user: process.env.FTP_USER, password: process.env.FTP_PASS, secure: false });
        await client.uploadFrom("planning.json", "public_html/planning.json");
        console.log("🚀 TERMINÉ !");

    } catch (error) {
        console.error("❌ ERREUR détectée. Prise d'une photo de l'écran...");
        await page.screenshot({ path: 'error.png', fullPage: true });
        
        try {
            await client.access({ host: process.env.FTP_HOST, user: process.env.FTP_USER, password: process.env.FTP_PASS, secure: false });
            await client.uploadFrom("error.png", "public_html/error.png");
            console.log("📸 Photo 'error.png' envoyée sur ton serveur. Va voir pour comprendre le blocage !");
        } catch (ftpErr) {
            console.error("Impossible d'envoyer la capture d'écran via FTP.");
        }
        throw error;
    } finally {
        await browser.close();
        client.close();
    }
})();