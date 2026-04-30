const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    console.log("🎬 Démarrage du script (Extraction enrichie pour MMIDASH)...");
    
    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--lang=fr-FR,fr'
        ] 
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("🚀 Connexion à l'ENT...");
        await page.goto('https://planning.univ-lemans.fr/direct/myplanning.jsp', { waitUntil: 'networkidle2' });

        // --- AUTHENTIFICATION ---
        await page.waitForSelector('#username');
        await page.type('#username', process.env.ADE_USER); 
        await page.type('#password', process.env.ADE_PASS);
        await Promise.all([
            page.click('#submitBtn'),
            page.waitForNavigation({ waitUntil: 'networkidle0' })
        ]);

        // --- PASSAGE DES ÉCRANS INTERMÉDIAIRES (MFA/PROCEED) ---
        await new Promise(r => setTimeout(r, 5000)); 
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('span, button, a'));
            const target = buttons.find(el => {
                const txt = el.innerText.toUpperCase();
                return txt.includes('PROCEED') || txt.includes('CONTINUE') || txt.includes('CONTINUER');
            });
            if (target) target.click();
        });

        console.log("⏳ Attente du chargement de l'interface ADE...");
        await new Promise(r => setTimeout(r, 8000)); 

        // --- NAVIGATION DANS L'ARBORESCENCE ---
        // Basé sur ton profil : BUT MMI1 TD11 11B à Laval
        const chemin = ["Etudiants", "IUT LAVAL", "Dpt MMI", "BUT MMI1", "TD11", "11B"];
        
        for (const texte of chemin) {
            console.log(`📍 Navigation : ${texte}`);
            const element = await page.waitForSelector(`xpath///span[text()="${texte}"]`, { visible: true, timeout: 20000 });
            
            // On cherche l'icône "+" pour déplier, sauf pour le dernier élément (le groupe)
            const icone = await page.$(`xpath///span[text()="${texte}"]/preceding-sibling::img[contains(@class, "x-tree3-node-joint")]`);
            
            if (icone && texte !== "11B") {
                await icone.click();
            } else {
                // Double clic sur le groupe final pour afficher le planning
                await element.click({ clickCount: 2 });
            }
            await new Promise(r => setTimeout(r, 3000)); 
        }

        console.log("📊 Extraction des données...");
        const planningData = await page.evaluate(() => {
            const jours = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
            
            return Array.from(document.querySelectorAll('.eventText'))
                .filter(b => b.innerText.trim().length > 1)
                .map(bloc => {
                    const container = bloc.parentElement.parentElement;
                    const left = parseInt(container.style.left) || 0;
                    const lignes = bloc.innerText.split('\n').map(s => s.trim()).filter(s => s !== "");
                    
                    // 1. Matière (souvent la 1ère ligne)
                    const matiere = lignes[0] || "Matière inconnue";
                    
                    // 2. Horaire via Regex
                    const horaireMatch = bloc.innerText.match(/\d{2}h\d{2}\s*-\s*\d{2}h\d{2}/);
                    const horaire = horaireMatch ? horaireMatch[0].replace(/\s/g, '') : "00h00-00h00";

                    // 3. Type de cours (TP / TD / Promo)
                    const fullText = lignes.join(' ').toUpperCase();
                    let type = "PROMO";
                    if (fullText.includes(' TP')) type = "TP";
                    else if (fullText.includes(' TD')) type = "TD";

                    // 4. Salle (Cherche les patterns classiques MMI ou Amphi)
                    const salle = lignes.find(l => l.includes('-MMI') || l.includes('Amphi') || l.includes('Salles')) || "N/C";

                    // 5. Prof (souvent la dernière ligne qui n'est pas la salle)
                    let prof = "Non spécifié";
                    if (lignes.length > 2) {
                        const derniereLigne = lignes[lignes.length - 1];
                        prof = derniereLigne === salle ? (lignes[lignes.length - 2] || "Non spécifié") : derniereLigne;
                    }

                    return {
                        jour: jours[Math.round(left / 245)] || "Inconnu",
                        matiere: matiere,
                        horaire: horaire.replace('-', ' - '),
                        type: type,
                        salle: salle,
                        prof: prof
                    };
                });
        });

        // --- SAUVEGARDE ---
        fs.writeFileSync('planning.json', JSON.stringify(planningData, null, 2));
        console.log(`✅ Extraction réussie : ${planningData.length} cours enregistrés.`);

    } catch (error) {
        console.error("❌ ERREUR DURANT LE SCRAPING :", error.message);
        await page.screenshot({ path: 'error.png' });
    } finally {
        await browser.close();
    }
})();