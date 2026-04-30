const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    console.log("🎬 Restauration du MMIDASH-BOT (Extraction Précise)...");
    
    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=fr-FR,fr'] 
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("🚀 Connexion et Bypass Proceed...");
        await page.goto('https://planning.univ-lemans.fr/direct/myplanning.jsp', { waitUntil: 'networkidle2' });

        await page.waitForSelector('#username', { timeout: 15000 });
        await page.type('#username', process.env.ADE_USER); 
        await page.type('#password', process.env.ADE_PASS);
        await Promise.all([
            page.click('#submitBtn'),
            page.waitForNavigation({ waitUntil: 'networkidle0' })
        ]);

        await new Promise(r => setTimeout(r, 5000));
        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button, span, a')).find(el => 
                ["PROCEED", "CONTINUER", "CONTINUE"].some(l => el.innerText.toUpperCase().includes(l))
            );
            if (btn) btn.click();
        });

        await new Promise(r => setTimeout(r, 8000)); 

        // Navigation (Trainees car tu as corrigé ça)
        const etapes = [["Etudiants", "Trainees"], ["IUT LAVAL", "IUT LAVAL"], ["Dpt MMI", "Dpt MMI"], ["BUT MMI1", "BUT MMI1"], ["TD11", "TD11"], ["11B", "11B"]];
        
        for (const [fr, en] of etapes) {
            await page.waitForFunction((f, e) => {
                const spans = Array.from(document.querySelectorAll('span'));
                return spans.some(s => (s.innerText.trim() === f || s.innerText.trim() === e) && s.offsetHeight > 0);
            }, { timeout: 20000 }, fr, en);

            const handle = await page.evaluateHandle((f, e) => {
                return Array.from(document.querySelectorAll('span')).find(s => s.innerText.trim() === f || s.innerText.trim() === e);
            }, fr, en);

            if (fr !== "11B") {
                await page.evaluate((f, e) => {
                    const span = Array.from(document.querySelectorAll('span')).find(s => s.innerText.trim() === f || s.innerText.trim() === e);
                    const icon = span?.parentElement?.querySelector('.x-tree3-node-joint');
                    if (icon) icon.click();
                }, fr, en);
                await new Promise(r => setTimeout(r, 2000));
            } else {
                await handle.click({ clickCount: 2 });
                await new Promise(r => setTimeout(r, 10000));
            }
        }

        // --- L'EXTRACTION QUI MARCHE VRAIMENT ---
        const planningData = await page.evaluate(() => {
            const joursSemaine = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
            return Array.from(document.querySelectorAll('.eventText')).map(bloc => {
                const container = bloc.parentElement.parentElement;
                const left = parseInt(container.style.left) || 0;
                const texteBrut = bloc.innerText.trim();
                const lignes = texteBrut.split('\n').map(s => s.trim()).filter(s => s !== "");
                
                // On cherche l'horaire pour l'isoler
                const horaireMatch = texteBrut.match(/\d{2}h\d{2}\s*-\s*\d{2}h\d{2}/);
                const horaire = horaireMatch ? horaireMatch[0].replace(/\s/g, '').replace('-', ' - ') : "N/C";
                
                // La matière est TOUJOURS la première ligne
                const matiere = lignes[0] || "Cours";

                // Le type (TP/TD/Promo)
                let type = "PROMO";
                if (texteBrut.toUpperCase().includes('TP')) type = "TP";
                else if (texteBrut.toUpperCase().includes('TD')) type = "TD";

                // La salle est souvent la ligne qui contient "MMI" ou "Amphi"
                const salle = lignes.find(l => l.includes('-MMI') || l.includes('Amphi') || l.includes('Salles')) || "N/C";

                // Le prof est généralement la dernière ligne, mais on vérifie qu'elle n'est pas égale à la salle
                let prof = "N/C";
                if (lignes.length >= 3) {
                    const derniere = lignes[lignes.length - 1];
                    const avantDerniere = lignes[lignes.length - 2];
                    // Si la dernière ligne est la salle, le prof est juste au-dessus
                    prof = (derniere === salle) ? avantDerniere : derniere;
                }

                return {
                    jour: joursSemaine[Math.round(left / 245)] || "Inconnu",
                    matiere: matiere,
                    horaire: horaire,
                    type: type,
                    salle: salle,
                    prof: prof
                };
            }).filter(c => c.horaire !== "N/C"); // On vire les blocs vides
        });

        fs.writeFileSync('planning.json', JSON.stringify(planningData, null, 2));
        console.log(`✅ Extraction terminée avec succès.`);

    } catch (error) {
        console.error("❌ ERREUR :", error.message);
        await page.screenshot({ path: 'error.png' });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();