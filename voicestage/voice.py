"""Bulbul voice profiles, validated delivery, and authored world reactions."""
import json
import math
import time
import uuid
from pathlib import Path

CATALOG = json.loads((Path(__file__).parent / 'shared' / 'voice-catalog.json').read_text())
CLIP_TTL = 600

def normalize_voice(values=None):
    result = dict(profile_id='sentinel', pace=1, temperature=.6, adaptive=True)
    result.update(values or {})
    if not any(p['id'] == result['profile_id'] for p in CATALOG['profiles']):
        raise ValueError('Choose a voice profile from the catalog.')
    for key, low, high in [('pace', .5, 2), ('temperature', .01, 1)]:
        value = result[key]
        if type(value) not in (float, int) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f'{key.title()} must be between {low} and {high}.')
    if type(result['adaptive']) is not bool:
        raise ValueError('Adaptive delivery must be true or false.')
    return result

def delivery_for(state, settings, language):
    profile = next(p for p in CATALOG['profiles'] if p['id'] == settings['profile_id'])
    tone = 'suspicious' if state['key_stolen'] else 'grateful' if state['helped_guard'] else 'watchful'
    factor = (1.04 if state['key_stolen'] else .96 if state['helped_guard'] else 1) if settings['adaptive'] else 1
    return dict(profile_id=profile['id'], speaker=profile['speakers'][language], pace=round(max(.5, min(2, settings['pace'] * factor)), 2), temperature=settings['temperature'], tone=tone)

def queue_clip(state, text, language, source, settings=None):
    clip = dict(**delivery_for(state, settings or normalize_voice(state.get('voice')), language), id=str(uuid.uuid4()), text=text, language_code=language, source=source, created_at=int(time.time() * 1000))
    state['clips'] = ([c for c in state.get('clips', []) if time.time() - c['created_at'] / 1000 < CLIP_TTL] + [clip])[-8:]
    return clip

def descriptor(clip, live):
    return dict(**clip, mode='live' if live else 'preview', url=f"/api/speech?id={clip['id']}" if live else None)

def action_reaction(s, action, language):
    hi = language == 'hi-IN'
    if action == 'reset': return None
    if action == 'steal_key':
        return 'अपना हाथ खोलो, यात्री। वह चाबी मेरी है। उसे लौटाओ; तब तक फाटक बंद रहेगा।' if hi else 'Open your hand, traveler. That key belongs on my belt. Return it; the gate stays closed.'
    if action == 'return_key':
        if hi: return 'चाबी लौट आई, और तुमने मेरी मदद भी की है। आगे बढ़ो, यात्री; फाटक खुला है।' if s['helped_guard'] else 'चाबी लौटाने के लिए धन्यवाद। मेरी बिखरी रसद समेटने में मदद करो, फिर प्रवेश की बात करेंगे।'
        return 'The key is back, and you have already earned my trust. You may enter.' if s['helped_guard'] else 'The key is back where it belongs. Help me recover my supplies, and we will speak of passage.'
    if hi: return 'मेरी रसद समेटने के लिए धन्यवाद। अब मेरी चाबी भी लौटाओ; तभी फाटक खुलेगा।' if s['key_stolen'] else 'तुमने मेरी मदद की, यात्री। मेरा भरोसा जीत लिया है तुमने; फाटक खुला है।'
    return 'You recovered my supplies. Now return my key, and I can open the gate.' if s['key_stolen'] else 'You stopped to help when others walked past. You have earned my trust; the gate is open.'
