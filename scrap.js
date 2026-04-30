const puppeteer = require('puppeteer');
const fs = require('fs');
const ftp = require("basic-ftp");

(async () => {
    console.log("🎬 Tentative de contournement du MFA...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();

    try {
        console.log("🔗 Connexion à ADE...");
        await page.goto('https://planning.univ-lemans.fr/direct/myplanning.jsp', { waitUntil: 'networkidle2' });

        // --- LOGIN ---
        await page.waitForSelector('#username');
        await page.type('#username', process.env.ADE_USER); 
        await page.type('#password', process.env.ADE_PASS);
        await Promise.all([
            page.click('#submitBtn'),
            page.waitForNavigation({ waitUntil: 'networkidle0' })
        ]);

        // --- GESTION DU MFA / PROCEED ---
        console.log("🛡️ Vérification des blocages de sécurité...");
        try {
            // On cherche le bouton "PROCEED" que tu as vu dans les logs
            const proceedBtn = await page.waitForSelector('xpath///span[contains(text(), "PROCEED")] | //button[contains(text(), "PROCEED")]', { timeout: 8000 });
            console.log("🔘 Bouton 'PROCEED' détecté, on force le passage...");
            await proceedBtn.click();
            await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
        } catch (e) {
            console.log("ℹ️ Pas de bouton 'PROCEED', on continue.");
        }

        // --- NAVIGATION ARBORESCENCE ---
        console.log("📂 Accès à l'emploi du temps...");
        await new Promise(r => setTimeout(r, 5000)); 

        const chemin = ["Etudiants", "IUT LAVAL", "Dpt MMI", "BUT MMI1", "TD11", "11B"];
        for (const texte of chemin) {
            console.log(`📍 Sélection de : ${texte}`);
            const element = await page.waitForSelector(`xpath///span[contains(text(), "${texte}")]`, { visible: true, timeout: 15000 });
            const icone = await page.$(`xpath///span[contains(text(), "${texte}")]/preceding-sibling::img[contains(@class, "x-tree3-node-joint")]`);
            
            if (icone && texte !== "11B") {
                await icone.click();
            } else {
                await element.click({ clickCount: 2 });
            }
            await new Promise(r => setTimeout(r, 3000)); 
        }

        // --- EXTRACTION ET ENVOI ---
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
        const client = new ftp.Client();
        await client.access({ host: process.env.FTP_HOST, user: process.env.FTP_USER, password: process.env.FTP_PASS, secure: false });
        await client.uploadFrom("planning.json", "public_html/planning.json");
        console.log("🚀 LE PLANNING EST ENFIN EN LIGNE !");
        client.close();

    } catch (error) {
        console.error("❌ ERREUR :", error.message);
    } finally {
        await browser.close();
    }
})();