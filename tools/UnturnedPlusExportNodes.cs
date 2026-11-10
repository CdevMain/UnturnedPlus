// ============================================================
// UnturnedPlusExportNodes.cs
// Script de Editor para o projeto U3-SDK (Unity).
//
// O que faz: com um level carregado no editor, exporta todos os
// nós do mapa (locais nomeados e pontos de airdrop) para um JSON
// no formato que o Unturned+ importa pelo botão "Importar JSON".
//
// Como usar:
// 1. Copie este arquivo para Assets/Editor/ no projeto U3-SDK.
// 2. Abra/carregue o level desejado no editor (conforme a doc do SDK).
// 3. Menu: Unturned+ -> Export Map Nodes.
// 4. O JSON é salvo em Assets/UnturnedPlus/<NomeDoMapa>.markers.json.
// 5. No app Unturned+, na página de tracking: "Importar JSON".
//
// Obs.: as APIs internas (SDG.Unturned) podem mudar entre versões
// do jogo — se algo não compilar, os nomes de LevelNodes/Level
// podem ter sido renomeados; ajuste conforme o source atual.
// ============================================================
#if UNITY_EDITOR
using System.IO;
using System.Text;
using UnityEditor;
using UnityEngine;
using SDG.Unturned;

public static class UnturnedPlusExportNodes
{
    [MenuItem("Unturned+/Export Map Nodes")]
    public static void Export()
    {
        if (Level.info == null)
        {
            EditorUtility.DisplayDialog("Unturned+",
                "Nenhum level carregado. Carregue um mapa no editor primeiro.", "OK");
            return;
        }

        string mapName = Level.info.name;
        int worldSize = Level.size; // tamanho do mundo em metros

        var sb = new StringBuilder();
        sb.Append("{\n");
        sb.AppendFormat("  \"worldSize\": {0},\n", worldSize);
        sb.Append("  \"markers\": [\n");

        bool first = true;

        // Percorre todos os nós do level
        foreach (Node node in LevelNodes.nodes)
        {
            string type = null;
            string name = null;

            if (node is LocationNode loc)
            {
                type = "location";
                name = loc.name;
            }
            else if (node.type == ENodeType.AIRDROP)
            {
                type = "airdrop";
                name = "Airdrop";
            }

            if (type == null) continue;

            if (!first) sb.Append(",\n");
            first = false;

            Vector3 p = node.point;
            sb.AppendFormat(
                "    {{ \"name\": \"{0}\", \"type\": \"{1}\", \"x\": {2}, \"z\": {3} }}",
                Escape(name), type,
                Mathf.RoundToInt(p.x), Mathf.RoundToInt(p.z));
        }

        // ---------- Spawns de itens ----------
        // LevelItems.spawns é uma grade de regiões; cada célula tem a
        // lista de ItemSpawnpoint com a posição (.point) do spawn.
        try
        {
            var grid = LevelItems.spawns;
            if (grid != null)
            {
                for (byte rx = 0; rx < Regions.WORLD_SIZE; rx++)
                for (byte ry = 0; ry < Regions.WORLD_SIZE; ry++)
                {
                    var cell = grid[rx, ry];
                    if (cell == null) continue;
                    foreach (ItemSpawnpoint sp in cell)
                    {
                        if (!first) sb.Append(",\n");
                        first = false;
                        Vector3 ip = sp.point;
                        sb.AppendFormat(
                            "    {{ \"name\": \"Item\", \"type\": \"item\", \"x\": {0}, \"z\": {1} }}",
                            Mathf.RoundToInt(ip.x), Mathf.RoundToInt(ip.z));
                    }
                }
            }
        }
        catch (System.Exception ex)
        {
            // Se a API interna mudou de nome nesta versão do source,
            // apenas registra e segue com locais + airdrops.
            Debug.LogWarning("[Unturned+] Falha ao exportar spawns de itens: " + ex.Message);
        }

        sb.Append("\n  ]\n}\n");

        string dir = Path.Combine(Application.dataPath, "UnturnedPlus");
        Directory.CreateDirectory(dir);
        string file = Path.Combine(dir, mapName + ".markers.json");
        File.WriteAllText(file, sb.ToString(), Encoding.UTF8);

        AssetDatabase.Refresh();
        EditorUtility.DisplayDialog("Unturned+",
            "Exportado com sucesso:\n" + file +
            "\n\nImporte este arquivo no app pelo botão \"Importar JSON\".", "OK");
        Debug.Log("[Unturned+] Nós exportados para " + file);
    }

    private static string Escape(string s)
    {
        return string.IsNullOrEmpty(s) ? "" :
            s.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }
}
#endif
