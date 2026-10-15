import asyncio
import httpx
import pytest
from fastapi.testclient import TestClient
import app as mod

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(mod,'API_KEY','')
    mod.sessions.clear()
    with TestClient(mod.app) as c:
        c.get('/api/state')
        yield c

def test_catalog_and_persistent_voice(client):
    assert len(client.get('/api/config').json()['voices']['profiles'])==3
    r=client.post('/api/voice',json={'profile_id':'warden','pace':.8,'adaptive':False})
    assert r.status_code==200
    assert client.get('/api/state').json()['voice']['profile_id']=='warden'
    client.post('/api/action',json={'action':'reset'})
    assert client.get('/api/state').json()['voice']['pace']==.8
    assert client.post('/api/voice',json={'pace':9}).status_code==422
    assert client.post('/api/voice',json={'speaker':'fake'}).status_code==422

def test_actions_and_auditions(client):
    r=client.post('/api/action',json={'action':'steal_key','language_code':'hi-IN'}).json()
    assert any('\u0900'<=c<='\u097f' for c in r['reply'])
    assert r['speech']['mode']=='preview' and not r['state']['gate_open']
    assert client.post('/api/action',json={'action':'steal_key'}).json()['reply'] is None
    sample=client.post('/api/audition',json={'profile_id':'storyteller','language_code':'hi-IN','sample_id':'grateful'}).json()
    assert sample['speech']['speaker']=='ratan_hi_documentary'
    state=client.get('/api/state').json()
    assert not state['state']['gate_open'] and state['history']==[]
    assert state['voice']['profile_id']=='sentinel'
    client.post('/api/action',json={'action':'reset'})
    assert client.get('/api/speech',params={'id':r['speech']['id']}).status_code==404

def test_speech_is_session_bound_and_lazy(client,monkeypatch):
    monkeypatch.setattr(mod,'API_KEY','test-secret')
    r=client.post('/api/action',json={'action':'help_guard'}).json()
    async def fake(key,clip):
        from fastapi.responses import StreamingResponse
        async def chunks():yield b'ID3test'
        return StreamingResponse(chunks(),media_type='audio/mpeg')
    monkeypatch.setattr(mod,'stream_speech',fake)
    with TestClient(mod.app) as other:
        other.get('/api/state')
        assert other.get(r['speech']['url']).status_code==404
    assert client.get(r['speech']['url']).content==b'ID3test'

def test_stream_yields_early_and_releases_resources():
    from provider import stream_speech
    class Chunks(httpx.AsyncByteStream):
        closed=False
        async def __aiter__(self):
            yield b'ID3'
            await asyncio.Event().wait()
        async def aclose(self):self.closed=True
    async def run():
        chunks=Chunks()
        client=httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,headers={'Content-Type':'audio/mpeg'},stream=chunks)))
        r=await stream_speech('secret',{'text':'Halt','language_code':'en-IN','speaker':'dev_en_conversational','pace':1,'temperature':.6},client=client)
        assert await anext(r.body_iterator)==b'ID3'
        await r.body_iterator.aclose()
        assert chunks.closed and client.is_closed
    asyncio.run(run())

def test_stream_rejects_json_empty_and_provider_errors():
    from provider import stream_speech,ProviderError
    async def run():
        for response in [httpx.Response(200,json={'error':'private-key'}),httpx.Response(200,content=b'',headers={'Content-Type':'audio/mpeg'}),httpx.Response(401,text='private-key')]:
            client=httpx.AsyncClient(transport=httpx.MockTransport(lambda r:response))
            with pytest.raises(ProviderError) as err:
                await stream_speech('secret',{'text':'hi','language_code':'en-IN','speaker':'dev_en_conversational','pace':1,'temperature':.6},client=client)
            assert 'private-key' not in str(err.value) and client.is_closed
    asyncio.run(run())

def test_disconnect_cancels_synthesis_before_first_byte(client,monkeypatch):
    from starlette.requests import Request
    from fastapi import Response
    monkeypatch.setattr(mod,'API_KEY','test-secret')
    clip=client.post('/api/action',json={'action':'help_guard'}).json()['speech']
    token=client.cookies.get('vs_session')
    async def run():
        began=asyncio.Event();closed=asyncio.Event()
        async def blocked(key,descriptor):
            began.set()
            try:await asyncio.Event().wait()
            finally:closed.set()
        monkeypatch.setattr(mod,'stream_speech',blocked)
        async def receive():
            await began.wait()
            return {'type':'http.disconnect'}
        req=Request({'type':'http','method':'GET','path':'/api/speech','headers':[(b'cookie',('vs_session='+token).encode())],'query_string':b'','scheme':'http','server':('testserver',80)},receive=receive)
        pending=asyncio.create_task(mod.speech(req,Response(),clip['id']))
        try:
            result=await asyncio.wait_for(asyncio.shield(pending),.2)
            assert result.status_code==499 and closed.is_set()
        finally:
            if not pending.done():pending.cancel()
            try:await pending
            except asyncio.CancelledError:pass
    asyncio.run(run())
