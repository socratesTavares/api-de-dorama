require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Rota raiz
app.get('/', (req, res) => {
  res.send('API de Doramas está rodando!');
});
// REGISTO AUTOMÁTICO DE NOVO UTILIZADOR/CONVIDADO
app.post('/api/users/register-guest', async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'ID do utilizador é obrigatório' });
  }

  try {
    // 1. Verifica se o utilizador já existe no Supabase
    const { data: existingUser } = await supabase
      .from('users')
      .select('coin_balance')
      .eq('id', userId)
      .maybeSingle();

    if (existingUser) {
      return res.json({ coinBalance: existingUser.coin_balance });
    }

    // 2. Se não existir, insere com 50 moedas de bónus
    const { data: newUser, error } = await supabase
      .from('users')
      .insert([{
        id: userId,
        phone_or_email: `guest_${userId.substring(0, 8)}@oneclick.app`,
        password_hash: 'guest_auto',
        coin_balance: 50
      }])
      .select('coin_balance')
      .single();

    if (error) {
      console.error('Erro ao inserir utilizador:', error.message);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ coinBalance: newUser.coin_balance });

  } catch (err) {
    console.error('Erro no servidor:', err.message);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});
// Rota para buscar os dados/saldo atualizado do utilizador
app.get('/api/users/:userId/balance', async (req, res) => {
  const { userId } = req.params;

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('coin_balance')
      .eq('id', userId)
      .maybeSingle();

    if (error || !user) {
      return res.status(404).json({ error: 'Utilizador não encontrado' });
    }

    return res.json({ coinBalance: user.coin_balance || 0 });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao consultar saldo' });
  }
});
//BUSCA CATALOGOS DE DORAMAS COM EPISODIOS ORDENADOS PELO NUMERO
app.get('/api/dramas', async (req, res) => {
  try {
    // 1. Busca todos os doramas
    const { data: dramas, error: dramaError } = await supabase
      .from('dramas')
      .select('*')
      .order('created_at', { ascending: false });

    if (dramaError) {
      console.error('Erro Supabase Dramas:', dramaError.message);
      return res.status(500).json({ error: dramaError.message });
    }

    if (!dramas || dramas.length === 0) {
      return res.json([]); // Retorna array vazio se não houver doramas
    }

    // 2. Busca os episódios para vincular o primeiro episódio
    const { data: episodes, error: epError } = await supabase
      .from('episodes')
      .select('id, drama_id, title, episode_number')
      .order('episode_number', { ascending: true });

    if (epError) {
      console.error('Erro Supabase Episódios:', epError.message);
    }

    // 3. Mapeia o resultado garantindo nomes idênticos ao Gson do Android
    const formattedDramas = dramas.map(drama => {
      // Procura o primeiro episódio deste dorama
      const dramaEps = (episodes || []).filter(ep => ep.drama_id === drama.id);
      const firstEp = dramaEps.length > 0 ? dramaEps[0] : null;

      return {
        id: drama.id,
        title: drama.title || 'Sem Título',
        category: drama.category || 'Geral',
        coverUrl: drama.cover_image_url || drama.cover_url || '',
        description: drama.description || 'Sem descrição cadastrada.',
        firstEpisodeId: firstEp ? firstEp.id : 'fea190a2-90c8-4ca9-9450-354fb5ca6ee8',
        firstEpisodeNumber: firstEp ? firstEp.episode_number : 1,
        firstEpisodeTitle: firstEp ? firstEp.title : 'Episódio 1'
      };
    });

    console.log(`[API /api/dramas] Retornando ${formattedDramas.length} doramas.`);
    return res.json(formattedDramas);

  } catch (err) {
    console.error('Erro interno servidor:', err.message);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
});
// Endpoint para buscar todos episódios de um dorama específico
app.get('/api/episodes/drama/:dramaId', async (req, res) => {
    try {
        const { dramaId } = req.params;

        const { data, error } = await supabase
            .from('episodes')
            .select('id, episode_number, title, is_locked') // Removido 'duration' daqui
            .eq('drama_id', dramaId)
            .order('episode_number', { ascending: true });

        if (error) {
            console.error("Erro Supabase:", error.message);
            return res.status(400).json({ error: error.message });
        }

        return res.status(200).json(data);
    } catch (err) {
        return res.status(500).json({ error: 'Erro interno no servidor' });
    }
});
// Endpoint para desbloquear episódios com verificação detalhada de erros
app.post('/api/episodes/unlock', async (req, res) => {
  const { userId, episodeId } = req.body;

  try {
    // 1. Procura o episódio
    const { data: episode } = await supabase
      .from('episodes')
      .select('id, video_url, is_free, coin_cost')
      .eq('id', episodeId)
      .maybeSingle();

    if (!episode) return res.status(404).json({ success: false, message: 'Episódio não encontrado' });

    // 2. Se for grátis
    if (episode.is_free) {
      return res.json({ unlocked: true, videoUrl: episode.video_url, coinCost: 0 });
    }

    // 3. Se já foi comprado antes
    const { data: unlocked } = await supabase
      .from('unlocked_episodes')
      .select('id')
      .eq('user_id', userId)
      .eq('episode_id', episodeId)
      .maybeSingle();

    if (unlocked) {
      return res.json({ unlocked: true, videoUrl: episode.video_url, coinCost: episode.coin_cost });
    }

    // 4. Verifica saldo
    const { data: user } = await supabase
      .from('users')
      .select('coin_balance')
      .eq('id', userId)
      .maybeSingle();

    if (!user) return res.status(404).json({ success: false, message: 'Utilizador não encontrado' });

    const cost = episode.coin_cost || 10;
    if (user.coin_balance < cost) {
      return res.json({ unlocked: false, videoUrl: null, coinCost: cost, message: 'Saldo insuficiente de moedas!' });
    }

    // 5. Efetua o débito e registra no histórico
    const newBalance = user.coin_balance - cost;
    await supabase.from('users').update({ coin_balance: newBalance }).eq('id', userId);
    await supabase.from('unlocked_episodes').insert([{ user_id: userId, episode_id: episodeId }]);

    return res.json({ unlocked: true, videoUrl: episode.video_url, coinCost: cost, newBalance: newBalance });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Erro no servidor' });
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});