const puppeteer = require('puppeteer');
const fs = require('fs');
const ftp = require("basic-ftp");

(async () => {
    console.log("🎬 Démarrage du script (Force French Language)...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--lang=fr-FR,fr' // Force la langue au niveau du navigateur
        ] 
    });
    const page = await browser.newPage();
    
    // Force les headers HTTP en français
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'fr-FR,fr;q=0.9'
    });

    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("🚀 Connexion à ADE...");
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
        await new Promise(r => setTimeout(r, 5000)); 
        await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('span, button, a'));
            elements.forEach(el => {
                const txt = el.innerText.toUpperCase();
                // On garde les deux au cas où la page de sécurité reste en anglais
                if (txt.includes('PROCEED') || txt.includes('CONTINUE') || txt.includes('CONTINUER')) el.click();
            });
        });

        console.log("⏳ Attente de l'interface en français...");
        await new Promise(r => setTimeout(r, 8000)); 

        // --- NAVIGATION ARBORESCENCE (RETOUR AU FRANÇAIS) ---
        const chemin = ["Etudiants", "IUT LAVAL", "Dpt MMI", "BUT MMI1", "TD11", "11B"];
        
        for (const texte of chemin) {
            console.log(`📍 Sélection de : ${texte}`);
            const element = await page.waitForSelector(`xpath///span[text()="${texte}"]`, { visible: true, timeout: 20000 });
            
            const icone = await page.$(`xpath///span[text()="${texte}"]/preceding-sibling::img[contains(@class, "x-tree3-node-joint")]`);
            
            if (icone && texte !== "11B") {
                await icone.click();
            } else {
                await element.click({ clickCount: 2 });
            }
            await new Promise(r => setTimeout(r, 3000)); 
        }

        // --- EXTRACTION ---
        console.log("📊 Extraction des cours...");
        const planningData = await page.evaluate(() => {
            const jours = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
            return Array.from(document.querySelectorAll('.eventText'))
                .filter(b => b.innerText.trim().length > 1)
                .map(bloc => {
                    const container = bloc.parentElement.parentElement;
                    const left = parseInt(container.style.left) || 0;
                    const lignes = bloc.innerText.split('\n').map(s => s.trim());
                    return {
                        jour: jours[Math.round(left / 245)] || "Inconnu",
                        matiere: lignes[0],
                        horaire: (bloc.innerText.match(/\d{2}h\d{2}\s*-\s*\d{2}h\d{2}/) || ["N/C"])[0],
                        salle: lignes.find(l => l.includes('-MMI') || l.includes('Amphi') || l.includes('Salles')) || "N/C",
                        _position: { x: left, y: parseInt(container.style.top) || 0 }
                    };
                });
        });

        // --- ENVOI ---
        fs.writeFileSync('planning.json', JSON.stringify(planningData, null, 2));
        const client = new ftp.Client();
        await client.access({ host: process.env.FTP_HOST, user: process.env.FTP_USER, password: process.env.FTP_PASS, secure: false });
        await client.uploadFrom("planning.json", "public_html/planning.json");
        
        console.log("🚀 VICTOIRE FINALE : LE PLANNING EST EN LIGNE (FR) !");
        client.close();

    } catch (error) {
        console.error("❌ ERREUR :", error.message);
        await page.screenshot({ path: 'error.png' });
    } finally {
        await browser.close();
    }
})();