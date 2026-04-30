const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    console.log("🎬 Lancement du MMIDASH-BOT (Mode Ultra-Robuste)...");
    
    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=fr-FR,fr'] 
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("🚀 Connexion à l'ENT...");
        await page.goto('https://planning.univ-lemans.fr/direct/myplanning.jsp', { waitUntil: 'networkidle2' });

        // --- AUTHENTIFICATION ---
        await page.waitForSelector('#username', { timeout: 15000 });
        await page.type('#username', process.env.ADE_USER); 
        await page.type('#password', process.env.ADE_PASS);
        await Promise.all([
            page.click('#submitBtn'),
            page.waitForNavigation({ waitUntil: 'networkidle0' })
        ]);

        // Attente anti-bug (redirections ADE)
        await new Promise(r => setTimeout(r, 10000)); 

        // --- NAVIGATION BILINGUE (FR/EN) ---
        const etapes = [
            ["Etudiants", "Students"],
            ["IUT LAVAL", "IUT LAVAL"],
            ["Dpt MMI", "Dpt MMI"],
            ["BUT MMI1", "BUT MMI1"],
            ["TD11", "TD11"],
            ["11B", "11B"]
        ];
        
        for (const [fr, en] of etapes) {
            console.log(`📍 Étape : ${fr} / ${en}`);
            
            // Attente que le texte FR ou EN apparaisse
            await page.waitForFunction(
                (f, e) => {
                    const spans = Array.from(document.querySelectorAll('span'));
                    return spans.some(s => (s.innerText.trim() === f || s.innerText.trim() === e) && s.offsetHeight > 0);
                },
                { timeout: 30000 },
                fr, en
            );

            // On récupère l'élément
            const handle = await page.evaluateHandle((f, e) => {
                return Array.from(document.querySelectorAll('span'))
                            .find(s => s.innerText.trim() === f || s.innerText.trim() === e);
            }, fr, en);

            if (fr !== "11B") {
                // On clique sur l'icône "+" pour déplier
                await page.evaluate((f, e) => {
                    const span = Array.from(document.querySelectorAll('span'))
                                      .find(s => s.innerText.trim() === f || s.innerText.trim() === e);
                    const icon = span?.parentElement?.querySelector('.x-tree3-node-joint');
                    if (icon) icon.click();
                }, fr, en);
                await new Promise(r => setTimeout(r, 2500));
            } else {
                // Double-clic final pour charger le planning
                await handle.click({ clickCount: 2 });
                console.log("⌛ Chargement final du planning...");
                await new Promise(r => setTimeout(r, 8000));
            }
        }

        // --- EXTRACTION ---
        console.log("📊 Extraction des cours en cours...");
        const planningData = await page.evaluate(() => {
            const joursSemaine = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
            const elements = Array.from(document.querySelectorAll('.eventText'));
            
            return elements.filter(b => b.innerText.trim().length > 5).map(bloc => {
                const container = bloc.parentElement.parentElement;
                const left = parseInt(container.style.left) || 0;
                const lignes = bloc.innerText.split('\n').map(s => s.trim()).filter(s => s !== "");
                
                const matiere = lignes[0] || "Cours";
                const horaireRaw = (bloc.innerText.match(/\d{2}h\d{2}\s*-\s*\d{2}h\d{2}/) || [""])[0];
                const horaire = horaireRaw.replace(/\s/g, '').replace('-', ' - ');
                
                const fullText = lignes.join(' ').toUpperCase();
                let type = "PROMO";
                if (fullText.includes('TP')) type = "TP";
                else if (fullText.includes('TD')) type = "TD";

                const salle = lignes.find(l => l.includes('-MMI') || l.includes('Amphi') || l.includes('Salles')) || "N/C";
                const prof = lignes.length > 2 ? lignes[lignes.length - 1] : "N/C";

                return {
                    jour: joursSemaine[Math.round(left / 245)] || "Inconnu",
                    matiere, horaire, type, salle, prof
                };
            });
        });

        // --- SAUVEGARDE ---
        fs.writeFileSync('planning.json', JSON.stringify(planningData, null, 2));
        console.log(`✅ Terminé ! ${planningData.length} cours trouvés.`);

    } catch (error) {
        console.error("❌ ERREUR FATALE :", error.message);
        await page.screenshot({ path: 'error.png' });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();