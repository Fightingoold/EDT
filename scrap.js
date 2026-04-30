const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    console.log("🎬 Démarrage du script MMIDASH...");
    
    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=fr-FR'] 
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("🚀 Connexion à l'ENT...");
        await page.goto('https://planning.univ-lemans.fr/direct/myplanning.jsp', { waitUntil: 'networkidle2' });

        // Authentification
        await page.waitForSelector('#username', { timeout: 10000 });
        await page.type('#username', process.env.ADE_USER); 
        await page.type('#password', process.env.ADE_PASS);
        await Promise.all([
            page.click('#submitBtn'),
            page.waitForNavigation({ waitUntil: 'networkidle0' })
        ]);

        // Attente forcée pour passer les éventuels écrans de redirection
        await new Promise(r => setTimeout(r, 8000)); 

        // --- NAVIGATION ROBUSTE ---
        const chemin = ["Etudiants", "IUT LAVAL", "Dpt MMI", "BUT MMI1", "TD11", "11B"];
        
        for (const texte of chemin) {
            console.log(`📍 Recherche de : ${texte}`);
            
            // On attend que l'élément soit présent dans le DOM et visible
            const elementSelector = `xpath///span[normalize-space(text())="${texte}"]`;
            await page.waitForSelector(elementSelector, { visible: true, timeout: 30000 });
            
            if (texte !== "11B") {
                // Cliquer sur l'icône de déploiement (+) juste avant le span
                const iconClicked = await page.evaluate((txt) => {
                    const span = Array.from(document.querySelectorAll('span')).find(s => s.innerText.trim() === txt);
                    const icon = span?.parentElement?.querySelector('.x-tree3-node-joint');
                    if (icon) { icon.click(); return true; }
                    return false;
                }, texte);
                
                if (!iconClicked) {
                    const el = await page.$(`xpath///span[normalize-space(text())="${texte}"]`);
                    await el.click();
                }
            } else {
                // Double-clic sur le groupe final
                const finalEl = await page.$(`xpath///span[normalize-space(text())="${texte}"]`);
                await finalEl.click({ clickCount: 2 });
            }
            await new Promise(r => setTimeout(r, 2000)); 
        }

        console.log("📊 Extraction des cours...");
        await new Promise(r => setTimeout(r, 5000)); // Attente chargement planning

        const planningData = await page.evaluate(() => {
            const jours = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
            return Array.from(document.querySelectorAll('.eventText'))
                .filter(b => b.innerText.trim().length > 5)
                .map(bloc => {
                    const container = bloc.parentElement.parentElement;
                    const left = parseInt(container.style.left) || 0;
                    const lignes = bloc.innerText.split('\n').map(s => s.trim()).filter(s => s !== "");
                    
                    const matiere = lignes[0] || "Inconnue";
                    const horaireMatch = bloc.innerText.match(/\d{2}h\d{2}\s*-\s*\d{2}h\d{2}/);
                    const horaire = horaireMatch ? horaireMatch[0].replace(/\s/g, '').replace('-', ' - ') : "N/C";
                    
                    const textTotal = lignes.join(' ').toUpperCase();
                    let type = "PROMO";
                    if (textTotal.includes('TP')) type = "TP";
                    else if (textTotal.includes('TD')) type = "TD";

                    const salle = lignes.find(l => l.includes('-MMI') || l.includes('Amphi') || l.includes('Salles')) || "N/C";
                    const prof = lignes.length > 2 ? lignes[lignes.length - 1] : "N/C";

                    return {
                        jour: jours[Math.round(left / 245)] || "Inconnu",
                        matiere, horaire, type, salle, prof
                    };
                });
        });

        fs.writeFileSync('planning.json', JSON.stringify(planningData, null, 2));
        console.log(`✅ ${planningData.length} cours extraits !`);

    } catch (error) {
        console.error("❌ ERREUR :", error.message);
        await page.screenshot({ path: 'error.png' });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();