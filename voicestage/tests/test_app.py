import asyncio
import pytest
import httpx
from fastapi.testclient import TestClient
import app as mod

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(mod, 'API_KEY', '')
    mod.sessions.clear()
    with TestClient(mod.app) as c:
        assert c.get('/api/state').status_code == 200
        yield c

def test_home_and_config(client):
    assert 'The Last Gate' in client.get('/').text
    assert client.get('/api/config').json()['mode']=='preview'
    assert 'SARVAM_API_KEY' not in client.get('/game/main.js').text

def test_gate_invariant_and_reset(client):
    def act(a): return client.post('/api/action',json={'action':a}).json()
    assert not act('return_key')['state']['gate_open']
    assert act('help_guard')['state']['gate_open']
    assert not act('steal_key')['state']['gate_open']
    assert act('return_key')['state']['gate_open']
    r=act('reset')['state']; assert not r['gate_open'] and not r['helped_guard']

def test_preview_memory_hindi_and_twenty_conversations(client):
    def say(t,lang='en-IN'):
        r=client.post('/api/talk',json={'text':t,'language_code':lang}); assert r.status_code==200; return r.json()
    say('My name is Rubin')
    assert 'Rubin' in say('Remember my name?')['reply']
    assert any('\u0900'<=c<='\u097f' for c in say('May I enter?','hi-IN')['reply'])
    for i in range(20):
        client.post('/api/action',json={'action':['steal_key','help_guard','return_key','reset'][i%4]})
        r=say('Can I enter?');s=r['state'];assert s['gate_open']==(s['helped_guard'] and not s['key_stolen'])
        assert r['mode']=='preview' and r['audio_base64'] is None
    assert len(client.get('/api/state').json()['history'])<=8

def test_invalid_inputs_and_origin(client):
    for payload in [{'text':' '},{'text':'x'*281},{'text':'Hi','language_code':'xx'},{'text':'Hi','state':{'gate_open':True}}]:
        assert client.post('/api/talk',json=payload).status_code==422
    assert client.post('/api/action',json={'action':'open_gate'}).status_code==422
    assert client.post('/api/action',json={'action':'help_guard'},headers={'Origin':'https://evil.invalid'}).status_code==403

def test_isolated_sessions(client):
    client.post('/api/action',json={'action':'help_guard'})
    with TestClient(mod.app) as other:
        assert not other.get('/api/state').json()['state']['gate_open']
    assert client.get('/api/state').json()['state']['gate_open']

def test_live_payloads_and_speech_warning(client,monkeypatch):
    monkeypatch.setattr(mod,'API_KEY','test-secret'); calls=[]
    async def fake(client,path,payload):
        calls.append((path,payload))
        if path.endswith('completions'):return {'choices':[{'message':{'content':'You may enter.'}}],'usage':{'total_tokens':22}}
        return {'audios':['UklGRg==']}
    monkeypatch.setattr(mod,'call_sarvam',fake)
    client.post('/api/action',json={'action':'help_guard'})
    r=client.post('/api/talk',json={'text':'Can I enter?','language_code':'hi-IN','delivery':'complete'}).json()
    assert r['audio_base64']=='UklGRg==' and r['mode']=='live'
    assert calls[0][1]['model']=='sarvam-105b-conversations'
    assert 'help_guard' in calls[0][1]['messages'][0]['content']
    assert calls[1][1]['model']=='bulbul:v4-flash'
    assert calls[1][1]['speaker']=='ratan_hi_customer_expressive'
    async def fail_tts(client,path,payload):
        if path.endswith('completions'):return {'choices':[{'message':{'content':'The gate is open.'}}]}
        raise mod.ProviderError('Speech service is unavailable.')
    monkeypatch.setattr(mod,'call_sarvam',fail_tts)
    r=client.post('/api/talk',json={'text':'Hello','delivery':'complete'}).json()
    assert r['reply']=='The gate is open.' and r['audio_warning'] and r['audio_base64'] is None
    assert client.get('/api/state').json()['history'][-1]['content']=='The gate is open.'

def test_llm_failure_preserves_history(client,monkeypatch):
    monkeypatch.setattr(mod,'API_KEY','test-secret')
    async def fail(*args): raise mod.ProviderError('Sarvam could not be reached.')
    monkeypatch.setattr(mod,'call_sarvam',fail)
    assert client.post('/api/talk',json={'text':'Hello','delivery':'complete'}).status_code==502
    assert client.get('/api/state').json()['history']==[]

def test_provider_errors_redacted():
    async def run():
        for response in [httpx.Response(401,text='private-key'),httpx.Response(200,text='oops')]:
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:response)) as c:
                with pytest.raises(mod.ProviderError) as err:await mod.call_sarvam(c,'/text-to-speech',{})
                assert 'private-key' not in str(err.value)
        async def timeout(r):raise httpx.ReadTimeout('private-key')
        async with httpx.AsyncClient(transport=httpx.MockTransport(timeout)) as c:
            with pytest.raises(mod.ProviderError) as err:await mod.call_sarvam(c,'/text-to-speech',{})
            assert 'private-key' not in str(err.value)
    asyncio.run(run())
